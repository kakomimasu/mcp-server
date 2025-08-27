import { StreamableHTTPTransport } from "@hono/mcp";

export const sessions: {
  [sessionId: string]: {
    transport: StreamableHTTPTransport;
    data?: {
      pic: string;
      gameId: string;
      nowTurn: number;
    };
  };
} = {};
