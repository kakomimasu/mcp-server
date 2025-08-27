import { StreamableHTTPTransport } from "@hono/mcp";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { Hono } from "hono";
import { createMcpServer } from "../src/mcp-server.ts";
import { sessions } from "../src/sessions.ts";

const app = new Hono();

app.get("/", (c) => {
  return c.text("Hello, MCP Server!");
});

app.all("/mcp", async (c) => {
  const sessionId = c.req.header("mcp-session-id");
  console.log("Session ID:", sessionId);
  console.log(await c.req.text());

  let transport: StreamableHTTPTransport;

  if (sessionId && sessions[sessionId]) {
    transport = sessions[sessionId].transport;
  } else if (!sessionId && isInitializeRequest(await c.req.json())) {
    transport = new StreamableHTTPTransport(
      {
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: async (sessionId) => {
          sessions[sessionId] = { transport };
          const mcpServer = createMcpServer(sessionId);

          await mcpServer.connect(transport);
        },
      },
    );

    transport.onclose = () => {
      if (transport.sessionId) {
        delete sessions[transport.sessionId];
      }
    };
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

  return transport.handleRequest(c);
});

export default app;
