import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "../../src/db";
import { answerKeyItems, exams, examStudents, idempotencyKeys, users } from "../../src/db/schema";
import { validateTestDatabaseUrl } from "../../src/lib/database-url-safety";
import { createOwnedExam, updateOwnedExam } from "../../src/lib/exams";
import { saveOwnedReviewedResult } from "../../src/lib/exam-results";
import { hashReviewedRequest } from "../../src/lib/idempotency";

after(closeDb);

test("una entrega preparada antes de cambiar el formato no se guarda y la actual sí", async () => {
  validateTestDatabaseUrl({ DATABASE_URL_TEST: process.env.DATABASE_URL, DATABASE_URL: process.env.DATABASE_URL_NORMAL });
  const db = getDb();
  const [owner] = await db.insert(users).values({ name: "Test", email: `${randomUUID()}@test.invalid`, passwordHash: "unused" }).returning();
  try {
    const exam = await createOwnedExam(owner.id, { title: "Test", numQuestions: 40, numOptions: 4, subject: null });
    const [student] = await db.insert(examStudents).values({ examId: exam.id, name: "Test" }).returning();
    await db.insert(answerKeyItems).values(Array.from({ length: 40 }, (_, i) => ({ examId: exam.id, questionNo: i + 1, correctOption: "A" })));
    await db.update(exams).set({ status: "key_validated" }).where(eq(exams.id, exam.id));
    const payload = { studentId: student.id, answers: Array.from({ length: 40 }, (_, i) => ({ questionNo: i + 1, optionIndex: 0 })), replace: false, expectedVersion: null, expectedStructureVersion: 1 };
    assert.equal((await updateOwnedExam(owner.id, exam.id, { title: "Nuevo" })).status, "updated");
    assert.equal((await updateOwnedExam(owner.id, exam.id, { sheetFormat: "uax-grid-40" })).status, "updated");
    assert.equal((await saveOwnedReviewedResult(owner.id, exam.id, payload, randomUUID())).status, "structure_conflict");
    const legacy = { studentId: payload.studentId, answers: payload.answers, replace: payload.replace, expectedVersion: payload.expectedVersion };
    assert.equal((await saveOwnedReviewedResult(owner.id, exam.id, legacy, randomUUID())).status, "structure_conflict");
    const key = randomUUID();
    assert.equal((await saveOwnedReviewedResult(owner.id, exam.id, { ...payload, expectedStructureVersion: 2 }, key)).status, "saved");
    assert.equal((await saveOwnedReviewedResult(owner.id, exam.id, payload, key)).status, "idempotency_conflict");
    const oldKey = randomUUID();
    await db.insert(idempotencyKeys).values({ ownerId: owner.id, examId: exam.id, key: oldKey, studentId: student.id, requestHash: hashReviewedRequest(legacy) });
    const replay = await saveOwnedReviewedResult(owner.id, exam.id, legacy, oldKey);
    assert.equal(replay.status, "saved");
    if (replay.status === "saved") assert.equal(replay.replayed, true);
  } finally { await db.delete(users).where(eq(users.id, owner.id)); }
});

test("guardar y cambiar formato se serializan sin aceptar una entrega obsoleta", async () => {
  validateTestDatabaseUrl({ DATABASE_URL_TEST: process.env.DATABASE_URL, DATABASE_URL: process.env.DATABASE_URL_NORMAL });
  const db = getDb();
  const [owner] = await db.insert(users).values({ name: "Race", email: `${randomUUID()}@test.invalid`, passwordHash: "unused" }).returning();
  try {
    const exam = await createOwnedExam(owner.id, { title: "Race", numQuestions: 40, numOptions: 4, subject: null });
    const [student] = await db.insert(examStudents).values({ examId: exam.id, name: "Race" }).returning();
    await db.insert(answerKeyItems).values(Array.from({ length: 40 }, (_, i) => ({ examId: exam.id, questionNo: i + 1, correctOption: "A" })));
    await db.update(exams).set({ status: "key_validated" }).where(eq(exams.id, exam.id));
    const payload = { studentId: student.id, answers: Array.from({ length: 40 }, (_, i) => ({ questionNo: i + 1, optionIndex: 0 })), replace: false, expectedVersion: null, expectedStructureVersion: 1 };
    const [save, change] = await Promise.all([
      saveOwnedReviewedResult(owner.id, exam.id, payload, randomUUID()),
      updateOwnedExam(owner.id, exam.id, { sheetFormat: "uax-grid-40" }),
    ]);
    assert.ok((save.status === "saved" && change.status === "results_exist") || (save.status === "structure_conflict" && change.status === "updated"));
  } finally { await db.delete(users).where(eq(users.id, owner.id)); }
});
