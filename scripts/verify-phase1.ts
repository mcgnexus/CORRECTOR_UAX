import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../src/db";
import { users } from "../src/db/schema";
import { createOwnedExam, deleteOwnedExam } from "../src/lib/exams";
import {
  listOwnedAnswerKey,
  saveOwnedAnswerKeyDraft,
  validateOwnedAnswerKey,
} from "../src/lib/exam-keys";
import { registerUser } from "../src/lib/users";

async function main() {
  const suffix = randomUUID().slice(0, 8);
  const emailA = `fase1-a-${suffix}@example.com`;
  const emailB = `fase1-b-${suffix}@example.com`;
  let examId = "";
  let ownerA = "";
  let ownerB = "";

  try {
    assert.equal(await registerUser({ name: "Fase 1 A", email: emailA, password: "prueba-fase-uno-1234" }), true);
    assert.equal(await registerUser({ name: "Fase 1 B", email: emailB, password: "prueba-fase-uno-1234" }), true);
    const db = getDb();
    const [userA] = await db.select({ id: users.id }).from(users).where(eq(users.email, emailA));
    const [userB] = await db.select({ id: users.id }).from(users).where(eq(users.email, emailB));
    assert.ok(userA && userB);
    ownerA = userA.id;
    ownerB = userB.id;

    const exam = await createOwnedExam(ownerA, {
      title: "Prueba clave Fase 1",
      subject: null,
      numQuestions: 2,
      numOptions: 4,
    });
    examId = exam.id;

    const parcial = await saveOwnedAnswerKeyDraft(ownerA, examId, {
      answers: [{ q: 1, answer: "B", confidence: null, editedByTeacher: true }],
    });
    assert.equal(parcial.status, "saved");
    const incompleta = await validateOwnedAnswerKey(ownerA, examId);
    assert.equal(incompleta.status, "invalid");

    const completa = await saveOwnedAnswerKeyDraft(ownerA, examId, {
      answers: [
        { q: 1, answer: "B", confidence: 0.8, editedByTeacher: false },
        { q: 2, answer: "D", confidence: null, editedByTeacher: true },
      ],
    });
    assert.equal(completa.status, "saved");
    assert.equal((await validateOwnedAnswerKey(ownerA, examId)).status, "validated");

    assert.equal((await listOwnedAnswerKey(ownerB, examId)).length, 0, "otro profesor lee la clave");
    assert.equal((await saveOwnedAnswerKeyDraft(ownerB, examId, { answers: [] })).status, "not_found");

    console.log("OK: borrador parcial, validación completa y aislamiento de clave verificados.");
  } finally {
    if (examId && ownerA) await deleteOwnedExam(ownerA, examId);
    const db = getDb();
    if (ownerA) await db.delete(users).where(eq(users.id, ownerA));
    if (ownerB) await db.delete(users).where(eq(users.id, ownerB));
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
