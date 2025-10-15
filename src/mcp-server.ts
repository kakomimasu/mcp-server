import { ApiClient, Game } from "@kakomimasu/client-js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { delay } from "@std/async";
import { z } from "zod";
import { getSessionData, SessionData, setSessionData } from "./kv.ts";

const aiList = ["a1", "a2", "a3", "a4", "none"] as const;

const outputGameSchema = {
  width: z.number().describe("フィールドの横幅"),
  height: z.number().describe("フィールドの縦幅"),
  points: z.array(z.array(z.number())).describe(
    "各マスのポイント情報。1次元目はY,2次元目はXの座標に対応",
  ),
  tiles: z.array(z.array(z.object({
    player: z.number().nullable().describe(
      "このマスを所有するプレイヤーのインデックス。空きマスの場合は null",
    ),
    type: z.number().nullable().describe(
      "マスの種類。player の値で変わる。player が null ならば常に空きマス。player が数値ならば、そのplayerId が所有するマスで、この値が 0なら陣地, 1なら壁",
    ),
  }))),
  nAgent: z.number().describe("エージェントの数"),
  nowTurn: z.number().describe("現在のターン数"),
  totalTurn: z.number().describe("総ターン数"),
  turnSec: z.number().describe(
    "1ターンの秒数。指定の秒数を過ぎると次のターンに進むのでそれまでに次の行動を送信する必要がある",
  ),
  players: z.array(z.object({
    agents: z.array(z.object({
      x: z.number().describe("エージェントのX座標"),
      y: z.number().describe("エージェントのY座標"),
      lastRes: z.number().nullish().describe(
        `最後の行動結果。
        0: 成功
        1: 競合（相手・自分の各エージェントの行動が同じマスに対しての操作した場合など）
        2: 無効（相手の壁などに移動した時など。先に REMOVE で壁を壊す必要がある）
        3: 同じターンに複数の行動指示（agentIndex 被り）
        4: 存在しないエージェントへの指示,
        5: 存在しない行動の指示`,
      ),
    })),
    point: z.object({
      areaPoint: z.number().describe("陣地ポイント"),
      wallPoint: z.number().describe("壁ポイント"),
    }),
    isMe: z.boolean().describe("自分のプレイヤーかどうか"),
  })),
};

function createOutputGameData(game: Game, sessionData: SessionData) {
  if (!game.field) {
    throw new Error("ゲームのフィールド情報が不正です");
  }

  const points1d = game.field.points;
  const tiles1d = game.field.tiles;
  const width = game.field.width;
  const height = game.field.height;

  const points = [];
  const tiles = [];
  for (let y = 0; y < height; y++) {
    const pointRow = [];
    const tileRow = [];
    for (let x = 0; x < width; x++) {
      pointRow.push(points1d[y * width + x]);
      tileRow.push(tiles1d[y * width + x]);
    }
    points.push(pointRow);
    tiles.push(tileRow);
  }

  return {
    points,
    tiles,
    width,
    height,
    nAgent: game.nAgent,
    nowTurn: game.turn,
    totalTurn: game.totalTurn,
    turnSec: game.transitionSec + game.operationSec,
    players: game.players.map((player, i) => {
      const lastLog = game.log.at(-1)?.players[i].actions;

      const agents = player.agents.map((agent, agentIndex) => ({
        x: agent.x,
        y: agent.y,
        lastRes: lastLog &&
          lastLog.find((actionLog) => actionLog.agentId === agentIndex)?.res,
      }));

      return ({
        agents: agents,
        point: player.point,
        isMe: i === sessionData.data?.playerIndex,
      });
    }),
  };
}

const apiClient = new ApiClient({
  baseUrl: "http://api.kakomimasu.com/v1",
});

export function createMcpServer() {
  const mcpServer = new McpServer({
    name: "囲みマス MCP",
    version: "0.1.0",
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
      aiNameList: z.array(z.string()).describe("AIの一覧"),
    },
  }, () => {
    const structuredContent = {
      aiNameList: aiList,
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
      openWorldHint: false,
    },
    inputSchema: {
      name: z.string().describe("自分の名前"),
      aiName: z.enum(aiList).describe(
        "対戦相手のAI名。get-ai-listで取得したAI名を指定します",
      ),
    },
    outputSchema: outputGameSchema,
  }, async ({ name, aiName }, { sessionId }) => {
    const joinRes = await apiClient.joinAiMatch({
      guestName: name,
      aiName: aiName,
      transitionSec: 1,
      operationSec: 15,
      boardName: "A-2",
      nAgent: 3,
      totalTurn: 10,
    });

    console.log("Starting game with ID:", joinRes.gameId);

    let game: Game | undefined;

    try {
      while (game?.status !== "gaming") {
        await delay(1000);

        const res = await apiClient.getMatch(joinRes.gameId);
        game = res;
      }
    } catch (error) {
      throw error;
    }

    if (!sessionId) {
      throw new Error("セッションIDが取得できません");
    }

    const sessionData = {
      data: {
        pic: joinRes.pic,
        gameId: joinRes.gameId,
        playerIndex: joinRes.index,
        nowTurn: game.turn,
      },
    };

    await setSessionData(sessionId, sessionData);

    const structuredContent = createOutputGameData(game, sessionData);
    return {
      content: [{
        type: "text",
        text: JSON.stringify(structuredContent),
      }],
      structuredContent: structuredContent,
    };
  });

  mcpServer.registerTool("join-game", {
    title: "ゲームIDで参加",
    description: "指定したゲームIDで参加します",
    annotations: {
      openWorldHint: false,
    },
    inputSchema: {
      name: z.string().describe("自分の名前"),
      gameId: z.string().uuid().describe("参加するゲームのID"),
    },
    outputSchema: outputGameSchema,
  }, async ({ name, gameId }, { sessionId }) => {
    const joinRes = await apiClient.joinGameIdMatch(gameId, {
      guestName: name,
    });

    console.log("Starting game with ID:", joinRes.gameId);

    let game: Game | undefined;

    try {
      while (game?.status !== "gaming") {
        await delay(1000);

        const res = await apiClient.getMatch(joinRes.gameId);
        game = res;
      }
    } catch (error) {
      throw error;
    }

    if (!sessionId) {
      throw new Error("セッションIDが取得できません");
    }

    const sessionData = {
      data: {
        pic: joinRes.pic,
        gameId: joinRes.gameId,
        playerIndex: joinRes.index,
        nowTurn: game.turn,
      },
    };

    await setSessionData(sessionId, sessionData);

    const structuredContent = createOutputGameData(game, sessionData);
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
      openWorldHint: false,
    },
    inputSchema: {
      actions: z.array(z.object({
        agentIndex: z.number().describe(
          "操作するエージェントのインデックス。0～nAgent-1 の範囲で指定",
        ),
        type: z.enum(["PUT", "MOVE", "REMOVE", "NONE"]).describe(
          `指定したエージェントが行う行動の種類。
          PUTは新規で x,y のマスに置く（既に壁のマスには置けない）
          MOVEは x,y のマスに移動（移動は上下左右斜めの1マス分のみ。相手の壁には進めない）
          REMOVEは x,y のマスある壁を削除（自分・相手どちらのマスも壁でなくすことができる）
          NONEは何もしない（x,y の指定は無視される）`,
        ),
        x: z.number().describe("行動を行うマスのX座標"),
        y: z.number().describe("行動を行うマスのY座標"),
      })).describe(
        "次のターンに行う行動の配列（同じエージェントに対しては1つの行動のみ指定できる）",
      ),
    },
    outputSchema: outputGameSchema,
  }, async ({ actions }, { sessionId }) => {
    if (!sessionId) {
      throw new Error("セッションIDが取得できません");
    }
    const sessionData = await getSessionData(sessionId);

    if (!sessionData) {
      throw new Error("セッションが見つかりません");
    }

    const data = sessionData.data;
    if (!data) {
      throw new Error(
        "ゲームが開始されていません。create-ai-gameを先に実行してください",
      );
    }

    const sendActionData = actions.map((action) => ({
      agentId: action.agentIndex,
      type: action.type,
      x: action.x,
      y: action.y,
    }));

    while (true) {
      try {
        const actionRes = await apiClient.setAction(data.gameId, {
          actions: sendActionData,
        }, {
          authMethods: { PIC: data.pic },
        });
        data.nowTurn = actionRes.turn;
        await setSessionData(sessionId, sessionData);
        break;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !error.message.includes("during the transition step")
        ) {
          throw error;
        }
      }
      await delay(500);
    }

    let game: Game | undefined;

    while (true) {
      try {
        game = await apiClient.getMatch(data.gameId);
        if (game.turn > data.nowTurn) {
          break;
        } else if (game.status === "ended") {
          throw new Error("ゲームが終了しました");
        }
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !error.message.includes("during the transition step")
        ) {
          throw error;
        }
      }
      await delay(1000);
    }

    const structuredContent = createOutputGameData(game!, sessionData);

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
