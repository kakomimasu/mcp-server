import { ApiClient, Game } from "@kakomimasu/client-js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { delay } from "@std/async";
import { z } from "zod";
import { sessions } from "./sessions.ts";

const aiList = ["a1", "a2", "a3", "a4", "none"] as const;

// let pic: string | undefined = undefined;
// let gameId: string | undefined = undefined;
// let nowTurn: number = 0;

const apiClient = new ApiClient({
  baseUrl: "http://api.kakomimasu.com/v1",
});

export function createMcpServer(sessionId: string) {
  const mcpServer = new McpServer({
    name: "囲みマス MCP",
    version: "0.1.0",
  });
  "，";

  mcpServer.registerTool("get-rule", {
    title: "ルール",
    description: "囲みマスのルールが載っているWebページのURLを取得します",
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
    inputSchema: {},
    outputSchema: {
      ruleUrl: z.string().describe("ルールの説明"),
    },
  }, () => {
    const structuredContent = {
      ruleUrl: "https://kakomimasu.com/rule",
    };

    return {
      content: [{
        type: "text",
        text: JSON.stringify(structuredContent),
      }],
      structuredContent: structuredContent,
    };
  });

  mcpServer.registerTool("get-ai-list", {
    title: "AI一覧",
    description: "AIの一覧を取得します",
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
    inputSchema: {},
    outputSchema: {
      result: z.array(z.string()).describe("AIの一覧"),
    },
  }, () => {
    const structuredContent = {
      result: aiList,
    };

    return {
      content: [{
        type: "text",
        text: JSON.stringify(structuredContent),
      }],
      structuredContent: structuredContent,
    };
  });

  mcpServer.registerTool("create-ai-game", {
    title: "AI対戦",
    description: "AI対戦のゲームを作成します",
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      name: z.string().describe("自分の名前"),
      aiName: z.enum(aiList).describe(
        "対戦相手のAI名。get-ai-listで取得したAI名を指定します",
      ),
    },
    outputSchema: {
      width: z.number().describe("フィールドの横幅"),
      height: z.number().describe("フィールドの縦幅"),
      points: z.array(z.number()).describe(
        "各マスのポイント情報。height x width 個の一次元配列で帰ってくる。",
      ),
      nAgent: z.number().describe("エージャントの数"),
      totalTurn: z.number().describe("総ターン数"),
      players: z.array(z.object({
        agents: z.array(z.object({
          x: z.number().describe("エージェントのX座標"),
          y: z.number().describe("エージェントのY座標"),
        })),
        point: z.object({
          areaPoint: z.number().describe("陣地ポイント"),
          wallPoint: z.number().describe("壁ポイント"),
        }),
      })),
      myPlayerIndex: z.number().describe("players 内の自分のインデックス"),
    },
  }, async ({ name, aiName }) => {
    const joinRes = await apiClient.joinAiMatch({
      guestName: name,
      aiName: aiName,
      transitionSec: 1,
      operationSec: 20,
      boardName: "A-1",
      totalTurn: 10,
    });

    console.log("Created AI game with ID:", joinRes);

    console.log("Starting game with ID:", joinRes.gameId);
    let game: Game | undefined;

    try {
      while (game?.status !== "gaming") {
        const res = await apiClient.getMatch(joinRes.gameId);
        game = res;
        if (game?.status === "gaming") {
          break;
        }
        await delay(1000);
      }
      console.log("Game started:", game);
    } catch (error) {
      console.error("Error starting game:", error);
      throw error;
    }

    const points = game.field?.points;
    const width = game.field?.width;
    const height = game.field?.height;

    if (!points || !width || !height) {
      throw new Error("ゲームのフィールド情報が不正です");
    }

    sessions[sessionId].data = {
      pic: joinRes.pic,
      gameId: joinRes.gameId,
      nowTurn: game.turn,
    };

    const structuredContent = {
      points: points,
      width: width,
      height: height,
      nAgent: game.nAgent,
      totalTurn: game.totalTurn,
      players: game.players.map((player) => ({
        agents: player.agents,
        point: player.point,
      })),
      myPlayerIndex: joinRes.index,
    };

    return {
      content: [{
        type: "text",
        text: JSON.stringify(structuredContent),
      }],
      structuredContent: structuredContent,
    };
  });

  mcpServer.registerTool("action-and-nextturn", {
    title: "行動送信して次のターンに進む",
    description:
      "次のターンに行う行動を送信します。送信するとゲームが次のターンに進みます",
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      actions: z.array(z.object({
        agentId: z.number().describe(
          "エージェントのID。0～nAgent-1 の範囲で指定",
        ),
        type: z.enum(["PUT", "MOVE", "REMOVE", "NONE"]).describe(
          "指定したエージェントが行う行動の種類。PUTは新規で x,y のマスに置く、MOVEは x,y のマスに移動、REMOVEは x,y のマスある壁を削除、NONEは何もしない",
        ),
        x: z.number().describe("行動を行うマスのX座標"),
        y: z.number().describe("行動を行うマスのY座標"),
      })).describe("次のターンに行う行動の配列"),
    },
    outputSchema: {
      width: z.number().describe("フィールドの横幅"),
      height: z.number().describe("フィールドの縦幅"),
      points: z.array(z.number()).describe(
        "各マスのポイント情報。height x width 個の一次元配列で帰ってくる。",
      ),
      nowTurn: z.number().describe("現在のターン数"),
      field: z.array(z.object({
        type: z.number().describe(
          "マスの種類。player の値で変わる。player が null ならば常に空きマス。player が数値ならば、そのplayerId が所有するマスで、この値が 0なら陣地, 1なら壁",
        ),
        player: z.number().nullable().describe(
          "このマスを所有するプレイヤーのインデックス。空きマスの場合は null",
        ),
      })),
      players: z.array(z.object({
        agents: z.array(z.object({
          x: z.number().describe("エージェントのX座標"),
          y: z.number().describe("エージェントのY座標"),
        })),
        point: z.object({
          areaPoint: z.number().describe("陣地ポイント"),
          wallPoint: z.number().describe("壁ポイント"),
        }),
      })),
    },
  }, async ({ actions }) => {
    const data = sessions[sessionId].data;

    if (!data) {
      throw new Error(
        "ゲームが開始されていません。create-ai-gameを先に実行してください",
      );
    }
    console.log("Starting game with ID:", data.gameId);

    while (true) {
      try {
        const actionRes = await apiClient.setAction(data.gameId, { actions }, {
          authMethods: { PIC: data.pic },
        });
        console.log("Action set:", actionRes);
        data.nowTurn = actionRes.turn;
        break;
      } catch (error) {
        console.error("Error setting action:", error);
        await delay(1000);
      }
    }

    let game: Game | undefined;

    while (true) {
      try {
        const res = await apiClient.getMatch(data.gameId);
        game = res;
        if (game && game.turn > data.nowTurn) {
          break;
        }
      } catch (error) {
        console.error("Error starting game:", error);
        // throw error;
      }

      await delay(1000);
    }
    console.log("Game started:", game);

    const points = game.field?.points;
    const width = game.field?.width;
    const height = game.field?.height;
    data.nowTurn = game.turn;

    if (!points || !width || !height) {
      throw new Error("ゲームのフィールド情報が不正です");
    }

    const structuredContent = {
      points: points,
      width: width,
      height: height,
      nowTurn: data.nowTurn,
      field: game.field?.tiles,
      players: game.players.map((player) => ({
        agents: player.agents,
        point: player.point,
      })),
    };

    return {
      content: [{
        type: "text",
        text: JSON.stringify(structuredContent),
      }],
      structuredContent: structuredContent,
    };
  });

  return mcpServer;
}
