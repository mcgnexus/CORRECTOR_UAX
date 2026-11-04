export type LimitedJsonResult =
  | { status: "ok"; value: unknown }
  | { status: "invalid" }
  | { status: "too_large" };

export async function readJsonLimited(request: Request, maxBytes: number): Promise<LimitedJsonResult> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > maxBytes) return { status: "too_large" };

  const reader = request.body?.getReader();
  if (!reader) return { status: "invalid" };

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { status: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { status: "invalid" };
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return { status: "ok", value: JSON.parse(new TextDecoder().decode(bytes)) as unknown };
  } catch {
    return { status: "invalid" };
  }
}
