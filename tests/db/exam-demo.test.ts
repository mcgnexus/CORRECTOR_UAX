import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "../../src/db";
import { answerKeyItems, examResults, exams, examStudents, students, users } from "../../src/db/schema";
import { validateTestDatabaseUrl } from "../../src/lib/database-url-safety";
import { createOwnedDemo, examDemo } from "../../src/lib/exam-demo";
import { validateOwnedAnswerKey } from "../../src/lib/exam-keys";
import { listOwnedExamRoster, saveOwnedReviewedResult } from "../../src/lib/exam-results";

after(closeDb);

test("demo privado transaccional: concurrencia, fichas vinculadas, clave manual y guardado normal", async () => {
  validateTestDatabaseUrl({ DATABASE_URL_TEST: process.env.DATABASE_URL, DATABASE_URL: process.env.DATABASE_URL_NORMAL });
  const db = getDb();
  const [owner, other] = await db.insert(users).values(["Demo A", "Demo B"].map((name) => ({
    name, email: `${randomUUID()}@test.invalid`, passwordHash: "unused",
  }))).returning();
  try {
    const concurrent = await Promise.all([createOwnedDemo(owner.id), createOwnedDemo(owner.id)]);
    assert.deepEqual(concurrent.map((result) => result.status).sort(), ["created", "existing"]);
    const examId = concurrent[0].examId!;
    assert.equal(concurrent[1].examId, examId);
    assert.equal((await db.select().from(exams).where(eq(exams.ownerId, owner.id))).length, 1);
    const roster = await listOwnedExamRoster(owner.id, examId);
    assert.equal(roster.length, 3);
    assert.equal((await listOwnedExamRoster(other.id, examId)).length, 0);
    assert.equal(roster.filter((student) => student.savedAt).length, 2);
    assert.ok(roster.every((student) => student.dni === null && student.score === null));
    const linked = await db.select({ ownerId: students.ownerId }).from(examStudents)
      .innerJoin(students, eq(students.id, examStudents.studentId)).where(eq(examStudents.examId, examId));
    assert.equal(linked.length, 3);
    assert.ok(linked.every((student) => student.ownerId === owner.id));
    const key = await db.select().from(answerKeyItems).where(eq(answerKeyItems.examId, examId));
    assert.ok(key.every((item) => item.llmConfidence === null && item.editedByTeacher));
    const pending = roster.find((student) => !student.savedAt)!;
    const payload = { studentId: pending.id, replace: false, expectedVersion: null, expectedStructureVersion: 1,
      answers: [0, 1, null, 3].map((optionIndex, index) => ({ questionNo: index + 1, optionIndex })) };
    assert.equal((await saveOwnedReviewedResult(owner.id, examId, payload, randomUUID())).status, "key_not_validated");
    assert.equal((await validateOwnedAnswerKey(other.id, examId)).status, "not_found");
    assert.equal((await validateOwnedAnswerKey(owner.id, examId)).status, "validated");
    const scored = await listOwnedExamRoster(owner.id, examId);
    for (const fixture of examDemo.students.filter((student) => student.answers)) {
      assert.equal(scored.find((student) => student.name === fixture.name)?.score, fixture.expectedScore);
    }
    const requestKey = randomUUID();
    const saved = await saveOwnedReviewedResult(owner.id, examId, payload, requestKey);
    assert.equal(saved.status, "saved");
    if (saved.status === "saved") {
      assert.equal(saved.result.version, 1);
      assert.equal(saved.result.score, "7.50");
      assert.equal(saved.result.blank, 1);
    }
    const replay = await saveOwnedReviewedResult(owner.id, examId, payload, requestKey);
    assert.equal(replay.status, "saved");
    if (replay.status === "saved") assert.equal(replay.replayed, true);
    assert.equal((await saveOwnedReviewedResult(owner.id, examId, { ...payload, answers: payload.answers.map((answer) => ({ ...answer, optionIndex: 4 })) }, randomUUID())).status, "invalid");
    assert.equal((await saveOwnedReviewedResult(owner.id, examId, { ...payload, replace: true, expectedVersion: 99 }, randomUUID())).status, "version_conflict");
    assert.equal((await db.select().from(examResults).where(eq(examResults.studentId, pending.id)))[0].version, 1);
    await db.update(exams).set({ title: "Ejemplo renombrado" }).where(eq(exams.id, examId));
    assert.equal((await createOwnedDemo(owner.id)).status, "existing");
    const second = await createOwnedDemo(other.id);
    assert.equal(second.status, "created");
    assert.notEqual(second.examId, examId);
    await db.delete(exams).where(eq(exams.id, examId));
    assert.equal((await createOwnedDemo(owner.id)).status, "created");
  } finally {
    await db.delete(users).where(eq(users.id, owner.id));
    await db.delete(users).where(eq(users.id, other.id));
  }
});
