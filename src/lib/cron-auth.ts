import { timingSafeEqual } from "node:crypto";

export function isCronAuthorized(candidate: string | null, secret: string | undefined) {
  if (!candidate || !secret || Buffer.byteLength(secret) < 32) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const provided = Buffer.from(candidate);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}
