import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "../../src/db";
import { examResultAnswers, examResults, examStudents, exams, idempotencyKeys, users } from "../../src/db/schema";
import { validateTestDatabaseUrl } from "../../src/lib/database-url-safety";
import { createOwnedStudent, importOwnedStudents, listOwnedExamRoster, updateOwnedStudent } from "../../src/lib/exam-results";
import { resolveExamAccess } from "../../src/lib/access";

after(closeDb);

test("edición optimista conserva datos legados y resultados, limita acceso y evita duplicados", async () => {
  validateTestDatabaseUrl({ DATABASE_URL_TEST: process.env.DATABASE_URL, DATABASE_URL: process.env.DATABASE_URL_NORMAL });
  const db = getDb();
  const [owner, other, admin] = await db.insert(users).values([
    { name: "Owner", email: `${randomUUID()}@test.invalid`, passwordHash: "unused" },
    { name: "Other", email: `${randomUUID()}@test.invalid`, passwordHash: "unused" },
    { name: "Admin", email: `${randomUUID()}@test.invalid`, passwordHash: "unused", role: "admin" as const },
  ]).returning();
  try {
    const [exam, secondExam] = await db.insert(exams).values([
      { ownerId: owner.id, title: "Student update", numQuestions: 1, numOptions: 4 },
      { ownerId: owner.id, title: "Other exam", numQuestions: 1, numOptions: 4 },
    ]).returning();
    const [legacy] = await db.insert(examStudents).values({ examId: exam.id, name: "Legacy", dni: "old-invalid" }).returning();
    const created = await createOwnedStudent(owner.id, exam.id, { name: "Pending", dni: "12345678Z" });
    assert.equal(created.status, "created");
    if (created.status !== "created") return;
    const pending = created.student;
    await db.insert(examResults).values({ studentId: legacy.id, correct: 1, wrong: 0, blank: 0, rawScore: "1", score: "10", version: 3 });
    await db.insert(examResultAnswers).values({ studentId: legacy.id, questionNo: 1, selectedOption: 0 });
    await db.insert(idempotencyKeys).values({ ownerId: owner.id, examId: exam.id, studentId: legacy.id, key: randomUUID(), requestHash: "a".repeat(64) });
    const resultBefore = await db.select().from(examResults).where(eq(examResults.studentId, legacy.id));
    const answersBefore = await db.select().from(examResultAnswers).where(eq(examResultAnswers.studentId, legacy.id));
    const keysBefore = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.studentId, legacy.id));
    assert.equal((await listOwnedExamRoster(owner.id, exam.id)).find((s) => s.id === legacy.id)?.dni, "old-invalid");
    const input = { name: "Corrected", dni: "00000000T", originalName: legacy.name, originalDni: legacy.dni };
    assert.equal((await updateOwnedStudent(other.id, exam.id, legacy.id, input)).status, "not_found");
    assert.equal((await updateOwnedStudent(owner.id, secondExam.id, legacy.id, input)).status, "student_not_found");
    assert.equal((await updateOwnedStudent(owner.id, exam.id, legacy.id, { ...input, dni: "old-invalid" })).status, "invalid");
    for (const malformed of [null, [], { ...input, version: 3 }, { name: input.name, dni: input.dni }, { ...input, originalDni: 1 }]) {
      assert.equal((await updateOwnedStudent(owner.id, exam.id, legacy.id, malformed)).status, "invalid");
    }
    assert.equal((await updateOwnedStudent(owner.id, exam.id, legacy.id, { ...input, dni: pending.dni })).status, "duplicate");
    assert.equal((await updateOwnedStudent(owner.id, exam.id, legacy.id, { ...input, originalName: ` ${legacy.name} ` })).status, "conflict");
    assert.equal(await resolveExamAccess(other.id, exam.id), undefined);
    const access = await resolveExamAccess(admin.id, exam.id);
    assert.ok(access?.isAdmin);
    const concurrent = await Promise.all([
      updateOwnedStudent(access.ownerId, exam.id, legacy.id, input),
      updateOwnedStudent(owner.id, exam.id, legacy.id, { ...input, name: "Competing" }),
    ]);
    assert.deepEqual(concurrent.map((r) => r.status).sort(), ["conflict", "updated"]);
    assert.deepEqual(await db.select().from(examResults).where(eq(examResults.studentId, legacy.id)), resultBefore);
    assert.deepEqual(await db.select().from(examResultAnswers).where(eq(examResultAnswers.studentId, legacy.id)), answersBefore);
    assert.deepEqual(await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.studentId, legacy.id)), keysBefore);
    const reloaded = (await listOwnedExamRoster(owner.id, exam.id)).find((s) => s.id === legacy.id);
    assert.equal(reloaded?.dni, input.dni);
    assert.equal(reloaded?.version, 3);
    assert.equal((await updateOwnedStudent(owner.id, exam.id, pending.id, { name: "Pending edited", dni: "X1234567L", originalName: pending.name, originalDni: pending.dni })).status, "updated");
    assert.equal((await listOwnedExamRoster(owner.id, exam.id)).find((s) => s.id === pending.id)?.savedAt, null);
    assert.equal((await importOwnedStudents(owner.id, exam.id, "nombre,dni\nValid,Y1234567X\nInvalid,bad")).status, "invalid");
    assert.equal((await listOwnedExamRoster(owner.id, exam.id)).length, 2);
  } finally {
    for (const user of [owner, other, admin]) await db.delete(users).where(eq(users.id, user.id));
  }
});
