import type { QueuedResult } from "./indexed-db";

export type QueueDecision =
  | { action: "ack" }
  | { action: "discard"; reason: "deleted" }
  | { action: "pending"; reason: "unauthorized" | "server" | "network" | "key_pending" }
  | { action: "blocked"; reason: "exists" | "version_conflict" | "structure_conflict" | "idempotency_conflict" | "rejected" };

export function classifyQueueResponse(status: number, code?: string): QueueDecision {
  if (status >= 200 && status < 300) return { action: "ack" };
  if (status === 404 || status === 410) return { action: "discard", reason: "deleted" };
  if (status === 401) return { action: "pending", reason: "unauthorized" };
  if (status >= 500) return { action: "pending", reason: "server" };
  if (status === 409 && code === "key_not_validated") return { action: "pending", reason: "key_pending" };
  if (status === 409 && (code === "exists" || code === "version_conflict" || code === "structure_conflict" || code === "idempotency_conflict")) {
    return { action: "blocked", reason: code };
  }
  return { action: "blocked", reason: "rejected" };
}

export function applyQueueDecision(entry: QueuedResult, decision: QueueDecision): QueuedResult | null {
  if (decision.action === "ack" || decision.action === "discard") return null;
  if (decision.action === "pending") {
    return {
      ...entry,
      status: "pending",
      retries: decision.reason === "key_pending" ? entry.retries : entry.retries + 1,
      lastError: decision.reason,
    };
  }
  return { ...entry, status: "blocked", lastError: decision.reason };
}
