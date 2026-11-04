import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../src/db";
import { users } from "../src/db/schema";
import { registerUser } from "../src/lib/users";
import { createOwnedExam, deleteOwnedExam, findOwnedExam, listOwnedExams, updateOwnedExam } from "../src/lib/exams";

async function main() {
  const sufijo = randomUUID().slice(0, 8);
  const emailA = `verif-a-${sufijo}@example.com`;
  const emailB = `verif-b-${sufijo}@example.com`;

  assert.equal(await registerUser({ name: "Profesor A", email: emailA, password: "contrasena-de-prueba-123" }), true, "no se creó A");
  assert.equal(await registerUser({ name: "Profesor B", email: emailB, password: "contrasena-de-prueba-123" }), true, "no se creó B");
  assert.equal(await registerUser({ name: "Profesor A", email: emailA, password: "contrasena-de-prueba-123" }), false, "email duplicado aceptado");

  const db = getDb();
  const [a] = await db.select({ id: users.id }).from(users).where(eq(users.email, emailA));
  const [b] = await db.select({ id: users.id }).from(users).where(eq(users.email, emailB));
  assert.ok(a && b, "no se encontraron los usuarios");

  const examenA = await createOwnedExam(a.id, { title: "Examen A", subject: null, numQuestions: 10, numOptions: 4 });
  const examenB = await createOwnedExam(b.id, { title: "Examen B", subject: "GyBD", numQuestions: 20, numOptions: 5 });

  assert.equal((await listOwnedExams(a.id)).length, 1, "A ve exámenes de más");
  assert.equal((await listOwnedExams(b.id)).length, 1, "B ve exámenes de más");

  assert.equal(await findOwnedExam(b.id, examenA.id), undefined, "B puede leer el examen de A");
  assert.equal(await updateOwnedExam(b.id, examenA.id, { title: "Secuestrado" }), undefined, "B puede editar el examen de A");
  assert.equal(await deleteOwnedExam(b.id, examenA.id), undefined, "B puede borrar el examen de A");

  const intacto = await findOwnedExam(a.id, examenA.id);
  assert.equal(intacto?.title, "Examen A", "el examen de A fue alterado");

  const actualizado = await updateOwnedExam(a.id, examenA.id, { title: "Examen A editado" });
  assert.equal(actualizado?.title, "Examen A editado", "A no puede editar su examen");

  await db.delete(users).where(eq(users.email, emailA));
  await db.delete(users).where(eq(users.email, emailB));

  console.log("OK: registro, CRUD y aislamiento entre profesores verificados.");
  console.log(`Exámenes creados y limpiados: ${examenA.title} / ${examenB.title}`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
