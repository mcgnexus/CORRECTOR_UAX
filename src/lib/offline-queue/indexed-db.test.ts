import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { deleteQueuedResult, listQueuedResults, purgeQueuedResults, saveQueuedResult, type QueuedResult } from "./indexed-db";

function newEntry(ownerId = randomUUID(), examId = randomUUID(), studentId = randomUUID()): QueuedResult {
  const id = randomUUID();
  return {
    id,
    ownerId,
    examId,
    studentId,
    answers: [{ questionNo: 1, optionIndex: null }, { questionNo: 2, optionIndex: 2 }],
    replace: false,
    expectedVersion: null,
    expectedStructureVersion: 1,
    idempotencyKey: id,
    createdAt: new Date().toISOString(),
    status: "pending",
    retries: 0,
    lastError: null,
  };
}

test("IndexedDB persists entries and lists only the authenticated owner partition", async () => {
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const entryA = newEntry(ownerA);
  const entryB = newEntry(ownerB);
  await saveQueuedResult(entryA);
  await saveQueuedResult(entryB);

  assert.deepEqual(await listQueuedResults(ownerA), [entryA]);
  assert.deepEqual(await listQueuedResults(ownerB), [entryB]);
  assert.deepEqual(await listQueuedResults(""), []);
});

test("legacy entries remain available but cannot be retried without explicit review", async () => {
  const owner = randomUUID();
  const entry = newEntry(owner);
  const legacy = { ...entry };
  delete legacy.expectedStructureVersion;
  await saveQueuedResult(legacy);
  const [listed] = await listQueuedResults(owner);
  assert.equal(listed.status, "blocked");
  assert.equal(listed.lastError, "structure_conflict");
  assert.equal(listed.expectedStructureVersion, undefined);
  assert.deepEqual(listed.answers, entry.answers);
});

test("owner-checked deletion and exam/student purge do not cross partitions", async () => {
  const owner = randomUUID();
  const examA = randomUUID();
  const examB = randomUUID();
  const student = randomUUID();
  const first = newEntry(owner, examA, student);
  const second = newEntry(owner, examB, student);
  await saveQueuedResult(first);
  await saveQueuedResult(second);

  await deleteQueuedResult(randomUUID(), first.id);
  assert.equal((await listQueuedResults(owner)).length, 2);
  await purgeQueuedResults(owner, { examId: examA, studentId: student });
  assert.deepEqual(await listQueuedResults(owner), [second]);
  await purgeQueuedResults(owner);
  assert.deepEqual(await listQueuedResults(owner), []);
});

test("rejects sensitive or malformed fields before IndexedDB writes", async () => {
  const owner = randomUUID();
  const withPii = { ...newEntry(owner), dni: "12345678Z" } as QueuedResult;
  const duplicateQuestions = { ...newEntry(owner), answers: [{ questionNo: 1, optionIndex: 0 }, { questionNo: 1, optionIndex: 1 }] };
  await assert.rejects(saveQueuedResult(withPii), /campos no permitidos/);
  await assert.rejects(saveQueuedResult(duplicateQuestions), /Respuestas offline inválidas/);
  assert.deepEqual(await listQueuedResults(owner), []);
});
