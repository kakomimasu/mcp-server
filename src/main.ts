import { StreamableHTTPTransport } from "@hono/mcp";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { Hono } from "hono";
import { createMcpServer } from "../src/mcp-server.ts";
import { sessions } from "../src/sessions.ts";

const app = new Hono();

app.get("/", (c) => {
  return c.text("Hello, MCP Server!");
});

app.get("/mcp", (c) => {
  console.log("GET /mcp");
  c.status(200);
  return c.text("MCP endpoint is working!");
});

app.post("/mcp", async (c) => {
  console.log("POST /mcp");
  console.log("method", c.req.method);
  const sessionId = c.req.header("mcp-session-id");
  console.log("Session ID:", sessionId);
  console.log(await c.req.text());
  console.log("sessions", sessions);

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

app.delete("/mcp", async (c) => {
  console.log("DELETE /mcp");
  const sessionId = c.req.header("mcp-session-id");
  console.log("Session ID:", sessionId);

  return c.newResponse(null, 200);
});

export default app;
