import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "../../src/db";
import { exams, examStudents, students, users } from "../../src/db/schema";
import { validateTestDatabaseUrl } from "../../src/lib/database-url-safety";
import { createDirectoryStudent, listDirectoryStudents, updateDirectoryStudent, deleteDirectoryStudent, assignDirectoryStudents, importDirectoryStudents } from "../../src/lib/students";
import { createOwnedStudent, importOwnedStudents } from "../../src/lib/exam-results";

after(closeDb);

test("directorio privado admite homonimos, asigna instantaneas y no borra historico", async () => {
  validateTestDatabaseUrl({ DATABASE_URL_TEST: process.env.DATABASE_URL, DATABASE_URL: process.env.DATABASE_URL_NORMAL });
  const db = getDb();
  const [owner, other] = await db.insert(users).values(["A", "B"].map((name) => ({ name, email: `${randomUUID()}@test.invalid`, passwordHash: "unused" }))).returning();
  try {
    const a = await createDirectoryStudent(owner.id, { name: "Alumno Uno", dni: null });
    const b = await createDirectoryStudent(owner.id, { name: "Alumno Uno", dni: "" });
    assert.equal(a.status, "created"); assert.equal(b.status, "created");
    if (a.status !== "created" || b.status !== "created") return;
    assert.notEqual(a.student.id, b.student.id);
    assert.equal((await listDirectoryStudents(other.id)).length, 0);
    assert.equal((await updateDirectoryStudent(other.id, a.student.id, { name: "Intruso", expectedVersion: 1 })).status, "not_found");
    const [exam, foreignExam] = await db.insert(exams).values([
      { ownerId: owner.id, title: "Propio", numQuestions: 2 }, { ownerId: other.id, title: "Ajeno", numQuestions: 2 },
    ]).returning();
    assert.equal((await assignDirectoryStudents(owner.id, foreignExam.id, [a.student.id])).status, "not_found");
    assert.equal((await assignDirectoryStudents(other.id, foreignExam.id, [a.student.id])).status, "not_found");
    assert.equal((await assignDirectoryStudents(owner.id, exam.id, [a.student.id, b.student.id])).status, "assigned");
    assert.equal((await assignDirectoryStudents(owner.id, exam.id, [a.student.id])).status, "assigned");
    assert.equal((await db.select().from(examStudents).where(eq(examStudents.examId, exam.id))).length, 2);
    assert.equal((await updateDirectoryStudent(owner.id, a.student.id, { name: "Nuevo Nombre", expectedVersion: 1 })).status, "updated");
    assert.equal((await db.select().from(examStudents).where(eq(examStudents.studentId, a.student.id)))[0].name, "Alumno Uno");
    assert.equal((await deleteDirectoryStudent(owner.id, a.student.id, false)).status, "confirmation_required");
    assert.equal((await deleteDirectoryStudent(owner.id, a.student.id, true)).status, "deleted");
    const historical = await db.select().from(examStudents).where(eq(examStudents.examId, exam.id));
    assert.equal(historical.length, 2); assert.ok(historical.some((s) => s.studentId === null));
  } finally { for (const u of [owner, other]) await db.delete(users).where(eq(users.id, u.id)); }
});

test("version optimista conserva cambios y DNI editado no duplica vinculo de examen", async () => {
  validateTestDatabaseUrl({ DATABASE_URL_TEST: process.env.DATABASE_URL, DATABASE_URL: process.env.DATABASE_URL_NORMAL });
  const db = getDb();
  const [owner] = await db.insert(users).values({ name: "Version", email: `${randomUUID()}@test.invalid`, passwordHash: "unused" }).returning();
  try {
    const [exam] = await db.insert(exams).values({ ownerId: owner.id, title: "Historico", numQuestions: 1 }).returning();
    const enrollment = await createOwnedStudent(owner.id, exam.id, { name: "Alumno", dni: "00000000T" });
    assert.equal(enrollment.status, "created");
    const [profile] = await listDirectoryStudents(owner.id);
    assert.equal((await updateDirectoryStudent(owner.id, profile.id, { dni: "12345678Z", expectedVersion: 1 })).status, "updated");
    assert.equal((await updateDirectoryStudent(owner.id, profile.id, { name: "Obsoleto", expectedVersion: 1 })).status, "conflict");
    assert.equal((await listDirectoryStudents(owner.id))[0].name, "Alumno");
    assert.equal((await createOwnedStudent(owner.id, exam.id, { name: "Alumno", dni: "12345678Z" })).status, "duplicate");
    assert.equal((await importOwnedStudents(owner.id, exam.id, "nombre,dni\nAlumno,12345678Z")).status, "invalid");
    const rows = await db.select().from(examStudents).where(eq(examStudents.examId, exam.id));
    assert.equal(rows.length, 1); assert.equal(rows[0].dni, "00000000T");
  } finally { await db.delete(users).where(eq(users.id, owner.id)); }
});

test("importacion atomica evita reintentos duplicados y nunca fusiona solo nombres", async () => {
  validateTestDatabaseUrl({ DATABASE_URL_TEST: process.env.DATABASE_URL, DATABASE_URL: process.env.DATABASE_URL_NORMAL });
  const db = getDb();
  const [owner] = await db.insert(users).values({ name: "Import", email: `${randomUUID()}@test.invalid`, passwordHash: "unused" }).returning();
  const record = { name: "Alumno Ficticio", dni: null, email: "demo@test.invalid", academicCode: null, groups: ["LAB1"], metadata: { Examen: "SI" } };
  try {
    const unconfirmed = await importDirectoryStudents(owner.id, [record], false);
    assert.equal(unconfirmed.status, "confirmation_required");
    const results = await Promise.all([importDirectoryStudents(owner.id, [record], true), importDirectoryStudents(owner.id, [record], true)]);
    assert.ok(results.every((r) => r.status === "imported"));
    assert.equal((await listDirectoryStudents(owner.id)).length, 1);
    assert.equal((await importDirectoryStudents(owner.id, [{ ...record, email: "second@test.invalid" }], false)).status, "confirmation_required");
    await importDirectoryStudents(owner.id, [{ ...record, email: "second@test.invalid" }], true);
    assert.equal((await listDirectoryStudents(owner.id)).length, 2);
    const d = await createDirectoryStudent(owner.id, { name: "Documento", dni: "12345678Z" });
    assert.equal(d.status, "created");
    assert.equal((await importDirectoryStudents(owner.id, [{ ...record, dni: "12345678Z" }], true)).status, "conflict");
    assert.equal((await db.select().from(students).where(eq(students.ownerId, owner.id))).length, 3);
  } finally { await db.delete(users).where(eq(users.id, owner.id)); }
});
