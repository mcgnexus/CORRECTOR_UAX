export function matchesQueueAccount(headers: Headers, userId: string) {
  const owner = headers.get("X-Queue-Owner");
  return owner === null || owner === userId;
}

export async function activeQueueAccount(ownerId: string, request: typeof fetch = fetch) {
  try {
    const response = await request("/api/account", { cache: "no-store" });
    return response.ok && (await response.json()).id === ownerId;
  } catch { return false; }
}
