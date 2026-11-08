import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import test, { after } from "node:test";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "../../src/db";
import {
  answerKeyItems,
  authAttempts,
  examResultAnswers,
  examResults,
  examStudents,
  exams,
  idempotencyKeys,
  scoringRules,
  users,
} from "../../src/db/schema";
import { findOwnedExam, listAccessibleExams, listOwnedExams } from "../../src/lib/exams";
import { isAdminUser, resolveExamAccess } from "../../src/lib/access";
import { deleteOwnedReviewedResult, deleteOwnedStudent, saveOwnedReviewedResult } from "../../src/lib/exam-results";
import { clearAuthRateLimit, purgeExpiredAuthAttempts } from "../../src/lib/rate-limit";

after(async () => { await closeDb(); });

test("purges expired rate-limit hashes but retains the current 15-minute window", async () => {
  const db = getDb();
  const expiredHash = createHash("sha256").update(randomUUID()).digest("hex");
  const activeHash = createHash("sha256").update(randomUUID()).digest("hex");
  await db.insert(authAttempts).values([
    { keyHash: expiredHash, attempts: 2, windowStartedAt: new Date(Date.now() - 16 * 60_000) },
    { keyHash: activeHash, attempts: 1, windowStartedAt: new Date() },
  ]);
  try {
    await purgeExpiredAuthAttempts();
    assert.equal((await db.select().from(authAttempts).where(eq(authAttempts.keyHash, expiredHash))).length, 0);
    assert.equal((await db.select().from(authAttempts).where(eq(authAttempts.keyHash, activeHash))).length, 1);
  } finally {
    await db.delete(authAttempts).where(eq(authAttempts.keyHash, activeHash));
    await db.delete(authAttempts).where(eq(authAttempts.keyHash, expiredHash));
  }
});

test("clears only the global email hash and the known email/IP hash", async () => {
  const db = getDb();
  const email = `${randomUUID()}@test.invalid`;
  const ip = "192.0.2.12";
  const hashes = [
    createHash("sha256").update(`email|${email}`).digest("hex"),
    createHash("sha256").update(`email-ip|${email}|${ip}`).digest("hex"),
    createHash("sha256").update(`email-ip|${email}|192.0.2.13`).digest("hex"),
  ];
  await db.insert(authAttempts).values(hashes.map((keyHash) => ({ keyHash, attempts: 1 })));
  try {
    await clearAuthRateLimit(email, ip);
    assert.equal((await db.select().from(authAttempts).where(eq(authAttempts.keyHash, hashes[0]))).length, 0);
    assert.equal((await db.select().from(authAttempts).where(eq(authAttempts.keyHash, hashes[1]))).length, 0);
    assert.equal((await db.select().from(authAttempts).where(eq(authAttempts.keyHash, hashes[2]))).length, 1);
  } finally {
    for (const keyHash of hashes) await db.delete(authAttempts).where(eq(authAttempts.keyHash, keyHash));
  }
});

test("ownership isolation and student, exam, and account cascades", async () => {
  const db = getDb();
  const nonce = randomUUID();
  const [owner] = await db.insert(users).values({ name: "Test Owner", email: `${nonce}@test.invalid`, passwordHash: "not-used" }).returning({ id: users.id });
  const [otherOwner] = await db.insert(users).values({ name: "Other Owner", email: `${randomUUID()}@test.invalid`, passwordHash: "not-used" }).returning({ id: users.id });
  const [admin] = await db.insert(users).values({ name: "Admin", email: `${randomUUID()}@test.invalid`, passwordHash: "not-used", role: "admin" }).returning({ id: users.id });
  try {
    const [exam] = await db.insert(exams).values({ ownerId: owner.id, title: "Cascade fixture", numQuestions: 2, numOptions: 4, status: "key_validated" }).returning({ id: exams.id });
    assert.ok(await findOwnedExam(owner.id, exam.id));
    assert.equal(await findOwnedExam(otherOwner.id, exam.id), undefined);
    assert.equal(await isAdminUser(otherOwner.id), false);
    assert.equal(await isAdminUser(admin.id), true);
    assert.deepEqual(await resolveExamAccess(owner.id, exam.id), { ownerId: owner.id, isAdmin: false });
    assert.equal(await resolveExamAccess(otherOwner.id, exam.id), undefined);
    assert.deepEqual(await resolveExamAccess(admin.id, exam.id), { ownerId: owner.id, isAdmin: true });
    assert.ok((await listAccessibleExams(admin.id)).some((item) => item.id === exam.id));
    assert.equal((await listAccessibleExams(otherOwner.id)).some((item) => item.id === exam.id), false);
    assert.equal((await listOwnedExams(otherOwner.id)).some((item) => item.id === exam.id), false);

    const [studentA, studentB, studentC] = await db.insert(examStudents).values([
      { examId: exam.id, name: "Fixture A", dni: "00000000T" },
      { examId: exam.id, name: "Fixture B", dni: "00000001R" },
      { examId: exam.id, name: "Fixture C", dni: "00000002W" },
    ]).returning({ id: examStudents.id });
    await db.insert(answerKeyItems).values([
      { examId: exam.id, questionNo: 1, correctOption: "A" },
      { examId: exam.id, questionNo: 2, correctOption: "B" },
    ]);
    await db.insert(scoringRules).values({ examId: exam.id, pointsCorrect: "1", pointsWrong: "0", pointsBlank: "0", maxScore: "10" });
    for (const student of [studentA, studentB]) {
      await db.insert(examResults).values({ studentId: student.id, correct: 1, wrong: 1, blank: 0, rawScore: "1", score: "5", version: 1 });
      await db.insert(examResultAnswers).values([
        { studentId: student.id, questionNo: 1, selectedOption: 0 },
        { studentId: student.id, questionNo: 2, selectedOption: 2 },
      ]);
      await db.insert(idempotencyKeys).values({ ownerId: owner.id, examId: exam.id, key: randomUUID(), requestHash: createHash("sha256").update(randomUUID()).digest("hex"), studentId: student.id });
    }

    const tombstoneKey = randomUUID();
    const tombstoneRequest = { studentId: studentC.id, answers: [{ questionNo: 1, optionIndex: 0 }, { questionNo: 2, optionIndex: 1 }], replace: false, expectedVersion: null, expectedStructureVersion: 1 };
    assert.equal((await saveOwnedReviewedResult(owner.id, exam.id, tombstoneRequest, tombstoneKey)).status, "saved");
    assert.deepEqual(await deleteOwnedReviewedResult(owner.id, exam.id, studentC.id), { status: "deleted" });
    assert.equal((await saveOwnedReviewedResult(owner.id, exam.id, tombstoneRequest, tombstoneKey)).status, "replayed_deleted");
    assert.equal((await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.studentId, studentC.id))).length, 1);
    assert.equal((await deleteOwnedStudent(owner.id, exam.id, studentC.id, true)).status, "deleted");
    assert.equal((await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.studentId, studentC.id))).length, 0);

    assert.equal((await deleteOwnedStudent(otherOwner.id, exam.id, studentA.id, true)).status, "not_found");
    assert.equal((await deleteOwnedStudent(owner.id, exam.id, studentA.id, false)).status, "result_requires_confirmation");
    assert.equal((await db.select().from(examResults).where(eq(examResults.studentId, studentA.id))).length, 1);
    assert.equal((await deleteOwnedStudent(owner.id, exam.id, studentA.id, true)).status, "deleted");
    assert.equal((await db.select().from(examResults).where(eq(examResults.studentId, studentA.id))).length, 0);
    assert.equal((await db.select().from(examResultAnswers).where(eq(examResultAnswers.studentId, studentA.id))).length, 0);
    assert.equal((await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.studentId, studentA.id))).length, 0);

    await db.delete(exams).where(eq(exams.id, exam.id));
    assert.equal((await db.select().from(answerKeyItems).where(eq(answerKeyItems.examId, exam.id))).length, 0);
    assert.equal((await db.select().from(scoringRules).where(eq(scoringRules.examId, exam.id))).length, 0);
    assert.equal((await db.select().from(examStudents).where(eq(examStudents.id, studentB.id))).length, 0);
    assert.equal((await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.examId, exam.id))).length, 0);

    const [accountExam] = await db.insert(exams).values({ ownerId: owner.id, title: "Account cascade fixture", numQuestions: 1, numOptions: 2 }).returning({ id: exams.id });
    const [accountStudent] = await db.insert(examStudents).values({ examId: accountExam.id, name: "Fixture account", dni: "00000002W" }).returning({ id: examStudents.id });
    await db.insert(answerKeyItems).values({ examId: accountExam.id, questionNo: 1, correctOption: "A" });
    await db.insert(scoringRules).values({ examId: accountExam.id, pointsCorrect: "1", pointsWrong: "0", pointsBlank: "0", maxScore: "10" });
    await db.insert(examResults).values({ studentId: accountStudent.id, correct: 1, wrong: 0, blank: 0, rawScore: "1", score: "10", version: 1 });
    await db.insert(examResultAnswers).values({ studentId: accountStudent.id, questionNo: 1, selectedOption: 0 });
    await db.insert(idempotencyKeys).values({ ownerId: owner.id, examId: accountExam.id, key: randomUUID(), requestHash: createHash("sha256").update(randomUUID()).digest("hex"), studentId: accountStudent.id });

    await db.delete(users).where(eq(users.id, owner.id));
    assert.equal((await db.select().from(exams).where(eq(exams.ownerId, owner.id))).length, 0);
    assert.equal((await db.select().from(examStudents).where(eq(examStudents.id, accountStudent.id))).length, 0);
    assert.equal((await db.select().from(examResults).where(eq(examResults.studentId, accountStudent.id))).length, 0);
    assert.equal((await db.select().from(examResultAnswers).where(eq(examResultAnswers.studentId, accountStudent.id))).length, 0);
    assert.equal((await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.ownerId, owner.id))).length, 0);
  } finally {
    await db.delete(users).where(eq(users.id, owner.id));
    await db.delete(users).where(eq(users.id, otherOwner.id));
    await db.delete(users).where(eq(users.id, admin.id));
  }
});
