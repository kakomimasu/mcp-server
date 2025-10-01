import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { Hono } from "hono";
import { StreamableHTTPTransport } from "../lib/hono-mcp/index.ts";
import { createMcpServer } from "../src/mcp-server.ts";
import { deleteSessionData, getSessionData, setSessionData } from "./kv.ts";

/** transport を再利用するためにメモリ上に保存 */
export const transports: {
  [sessionId: string]: StreamableHTTPTransport;
} = {};

const app = new Hono();

app.get("/", (c) => {
  return c.text("Hello, MCP Server!");
});

app.all("/mcp", async (c) => {
  const sessionId = c.req.header("mcp-session-id");
  console.log(c.req.method, "/mcp", "Session ID:", sessionId);

  let transport: StreamableHTTPTransport;

  if (sessionId && transports[sessionId]) {
    // メモリ上に sessionId に紐づく transport があればそれを使う
    transport = transports[sessionId];
  } else if (sessionId && await getSessionData(sessionId)) {
    // メモリ上にないが、KVに sessionId に紐づくデータがあれば新規に transport を作成して使う
    transport = new StreamableHTTPTransport(
      {
        initialSessionId: sessionId,
        sessionIdGenerator: undefined,
        onsessioninitialized: (sessionId: string) => {
          transports[sessionId] = transport;
        },
      },
    );
    transport.onclose = () => {
      if (transport.sessionId) {
        deleteSessionData(transport.sessionId);
      }
    };

    const mcpServer = createMcpServer();
    await mcpServer.connect(transport);
  } else if (!sessionId && isInitializeRequest(await c.req.json())) {
    // sessionId がなく、初期化リクエストであれば新規に transport を作成して使う
    transport = new StreamableHTTPTransport(
      {
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (sessionId: string) => {
          setSessionData(sessionId, {});
          transports[sessionId] = transport;
        },
      },
    );
    transport.onclose = () => {
      if (transport.sessionId) {
        deleteSessionData(transport.sessionId);
      }
    };

    const mcpServer = createMcpServer();
    await mcpServer.connect(transport);
  } else {
    return c.newResponse(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided",
        },
        id: null,
      }),
      400,
    );
  }
  try {
    const res = await transport.handleRequest(c);
    return res;
  } catch (e) {
    throw e;
  }
});

export default app;
