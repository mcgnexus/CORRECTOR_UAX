import assert from "node:assert/strict";
import test from "node:test";
import { classifyQueueResponse, applyQueueDecision } from "./queue-state";
import type { QueuedResult } from "./indexed-db";

const entry: QueuedResult = {
  id: "bd4cff3d-e377-4db3-86df-26d595f8ef14",
  ownerId: "bd4cff3d-e377-4db3-86df-26d595f8ef15",
  examId: "bd4cff3d-e377-4db3-86df-26d595f8ef16",
  studentId: "bd4cff3d-e377-4db3-86df-26d595f8ef17",
  answers: [{ questionNo: 1, optionIndex: null }],
  replace: false,
  expectedVersion: null,
  idempotencyKey: "bd4cff3d-e377-4db3-86df-26d595f8ef14",
  createdAt: "2026-11-04T22:00:00.000Z",
  status: "pending",
  retries: 0,
  lastError: null,
};

test("classifies ACK, deleted resources, retryable failures and conflicts", () => {
  assert.deepEqual(classifyQueueResponse(200), { action: "ack" });
  assert.deepEqual(classifyQueueResponse(410), { action: "discard", reason: "deleted" });
  assert.deepEqual(classifyQueueResponse(401), { action: "pending", reason: "unauthorized" });
  assert.deepEqual(classifyQueueResponse(503), { action: "pending", reason: "server" });
  assert.deepEqual(classifyQueueResponse(409, "key_not_validated"), { action: "pending", reason: "key_pending" });
  assert.deepEqual(classifyQueueResponse(409, "version_conflict"), { action: "blocked", reason: "version_conflict" });
  assert.deepEqual(classifyQueueResponse(409, "exists"), { action: "blocked", reason: "exists" });
  assert.deepEqual(classifyQueueResponse(409, "idempotency_conflict"), { action: "blocked", reason: "idempotency_conflict" });
  assert.deepEqual(classifyQueueResponse(400), { action: "blocked", reason: "rejected" });
});

test("ACK and deleted entries are removed; retry decisions preserve the same payload and key", () => {
  assert.equal(applyQueueDecision(entry, classifyQueueResponse(200)), null);
  assert.equal(applyQueueDecision(entry, classifyQueueResponse(404)), null);
  const retry = applyQueueDecision(entry, classifyQueueResponse(503));
  assert.equal(retry?.idempotencyKey, entry.idempotencyKey);
  assert.deepEqual(retry?.answers, entry.answers);
  assert.equal(retry?.retries, 1);
  const pendingKey = applyQueueDecision(entry, classifyQueueResponse(409, "key_not_validated"));
  assert.equal(pendingKey?.retries, 0);
  assert.equal(pendingKey?.lastError, "key_pending");
});
