export type SessionData = {
  data?: {
    pic: string;
    gameId: string;
    playerIndex: number;
    nowTurn: number;
  };
};

export const kv = await Deno.openKv();

export async function getSessionData(sessionId: string) {
  const data = await kv.get<SessionData>(["sessions", sessionId]);
  return data.value;
}

export async function setSessionData(sessionId: string, data: SessionData) {
  await kv.set(["sessions", sessionId], data, {
    expireIn: 1000 * 60 * 60 * 24, // DELETE が送られてこないと情報が残ったままなので、約1日でexpireさせる
  });
}

export async function deleteSessionData(sessionId: string) {
  await kv.delete(["sessions", sessionId]);
}
