import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { eq, sql } from "drizzle-orm";
import { closeDb, getDb } from "../../src/db";
import { answerKeyItems, examMatrixProfiles, examResults, exams, examStudents, users } from "../../src/db/schema";
import { validateTestDatabaseUrl } from "../../src/lib/database-url-safety";
import { createOwnedExam, updateOwnedExam } from "../../src/lib/exams";
import { getOwnedMatrixProfile, saveOwnedMatrixProfile } from "../../src/lib/exam-matrix";
import { examCreateSchema } from "../../src/lib/validation";

after(closeDb);

const bubbles = {
  bubbles: Array.from({ length: 160 }, (_, i) => ({ questionNo: Math.floor(i / 4) + 1, optionIndex: i % 4, x: 0.1 + i % 4 * 0.1, y: 0.1 + Math.floor(i / 4) * 0.02 })),
  bubbleRadius: 0.01, rowsPerBlock: 20, blocks: 2, optionsPerBlock: 4,
};
const uax = {
  format: "uax-grid-40", version: 1, rowsPerBlock: 20, blocks: 2, optionsPerBlock: 4,
  tables: [0.1, 0.6].map((x) => ({
    corners: [{ x, y: 0.1 }, { x: x + 0.3, y: 0.1 }, { x: x + 0.3, y: 0.9 }, { x, y: 0.9 }],
    reference: Buffer.alloc(320 * 880, 255).toString("base64"),
  })),
};

test("migracion 0008 conserva un perfil anterior y rechaza formas cruzadas o UAX incompleto", async () => {
  validateTestDatabaseUrl({ DATABASE_URL_TEST: process.env.DATABASE_URL, DATABASE_URL: process.env.DATABASE_URL_NORMAL });
  const migration = await readFile(new URL("../../drizzle/0008_exam_sheet_format.sql", import.meta.url), "utf8");
  await getDb().transaction(async (tx) => {
    // Temporary tables shadow public tables only on this transaction's connection.
    await tx.execute(sql`create temporary table exams (id uuid primary key, num_questions integer not null, num_options integer not null) on commit drop`);
    await tx.execute(sql`create temporary table exam_matrix_profiles (
      exam_id uuid primary key, bubbles jsonb not null, bubble_radius real not null,
      rows_per_block integer not null, blocks integer not null, options_per_block integer not null
    ) on commit drop`);
    const id = randomUUID();
    await tx.execute(sql`insert into pg_temp.exams values (${id}, 40, 4)`);
    await tx.execute(sql`insert into pg_temp.exam_matrix_profiles values (${id}, ${JSON.stringify(bubbles.bubbles)}::jsonb, 0.01, 20, 2, 4)`);
    const [before] = await tx.execute(sql`select * from pg_temp.exam_matrix_profiles`);
    const [temporary] = await tx.execute(sql`select to_regclass('pg_temp.exams') is not null as present`);
    assert.equal(temporary.present, true);
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) await tx.execute(sql.raw(statement));
    }
    const [after] = await tx.execute(sql`select * from pg_temp.exam_matrix_profiles`);
    assert.deepEqual(after, { ...before, format: "bubbles", version: 1, uax_data: null });
    assert.equal((await tx.execute(sql`select sheet_format from pg_temp.exams`))[0].sheet_format, "bubbles");
    for (const statement of [
      sql`update pg_temp.exams set sheet_format = 'uax-grid-40', num_questions = 39`,
      sql`update pg_temp.exam_matrix_profiles set format = 'uax-grid-40'`,
      sql`update pg_temp.exam_matrix_profiles set bubbles = null`,
      sql`update pg_temp.exam_matrix_profiles set format = 'uax-grid-40', bubbles = null, bubble_radius = null, uax_data = '{}'::jsonb`,
    ]) {
      await assert.rejects(tx.transaction(async (savepoint) => { await savepoint.execute(statement); }));
    }
    await tx.execute(sql`update pg_temp.exam_matrix_profiles set format = 'uax-grid-40', bubbles = null, bubble_radius = null, uax_data = ${JSON.stringify({ tables: uax.tables })}::jsonb`);
    assert.equal((await tx.execute(sql`select bubbles from pg_temp.exam_matrix_profiles`))[0].bubbles, null);
  });
});

test("formatos persistidos: compatibilidad, PATCH parcial, invalidacion, aislamiento y carrera", async () => {
  validateTestDatabaseUrl({ DATABASE_URL_TEST: process.env.DATABASE_URL, DATABASE_URL: process.env.DATABASE_URL_NORMAL });
  const db = getDb();
  const [owner, other] = await db.insert(users).values(["Formato A", "Formato B"].map((name) => ({ name, email: `${randomUUID()}@test.invalid`, passwordHash: "unused" }))).returning();
  try {
    const exam = await createOwnedExam(owner.id, examCreateSchema.parse({ title: "Legacy", numQuestions: 40 }));
    assert.equal(exam.sheetFormat, "bubbles");
    // Inserting only legacy columns exercises the migration defaults, without fake bubbles for UAX.
    await db.insert(examMatrixProfiles).values({ examId: exam.id, ...bubbles });
    const legacy = await getOwnedMatrixProfile(owner.id, exam.id);
    assert.ok(legacy && legacy.format !== "uax-grid-40");
    assert.deepEqual(legacy.bubbles, bubbles.bubbles);
    assert.equal(await getOwnedMatrixProfile(other.id, exam.id), null);
    assert.equal((await saveOwnedMatrixProfile(other.id, exam.id, uax)).status, "not_found");
    assert.equal((await saveOwnedMatrixProfile(owner.id, exam.id, uax)).status, "invalid");
    await db.insert(answerKeyItems).values({ examId: exam.id, questionNo: 1, correctOption: "A" });
    await db.update(exams).set({ status: "key_validated" }).where(eq(exams.id, exam.id));
    assert.equal((await updateOwnedExam(owner.id, exam.id, { title: "Renamed" })).status, "updated");
    assert.ok(await getOwnedMatrixProfile(owner.id, exam.id));
    const changed = await updateOwnedExam(owner.id, exam.id, { sheetFormat: "uax-grid-40" });
    assert.equal(changed.status, "updated");
    if (changed.status === "updated") assert.equal(changed.exam.status, "key_validated");
    assert.equal(await getOwnedMatrixProfile(owner.id, exam.id), null);
    assert.equal((await db.select().from(answerKeyItems).where(eq(answerKeyItems.examId, exam.id))).length, 1);
    assert.equal((await saveOwnedMatrixProfile(owner.id, exam.id, bubbles)).status, "invalid");
    assert.equal((await saveOwnedMatrixProfile(owner.id, exam.id, uax)).status, "saved");
    assert.equal((await getOwnedMatrixProfile(owner.id, exam.id))?.format, "uax-grid-40");
    assert.equal((await updateOwnedExam(owner.id, exam.id, { numQuestions: 39 })).status, "invalid");
    assert.equal((await db.select().from(exams).where(eq(exams.id, exam.id)))[0].numQuestions, 40);
    assert.ok(await getOwnedMatrixProfile(owner.id, exam.id));
    const [student] = await db.insert(examStudents).values({ examId: exam.id, name: "Alumno" }).returning();
    await db.insert(examResults).values({ studentId: student.id });
    assert.equal((await updateOwnedExam(owner.id, exam.id, { sheetFormat: "bubbles" })).status, "results_exist");
    assert.equal((await getOwnedMatrixProfile(owner.id, exam.id))?.format, "uax-grid-40");
    await db.delete(examResults).where(eq(examResults.studentId, student.id));
    const race = await Promise.all([
      saveOwnedMatrixProfile(owner.id, exam.id, uax),
      updateOwnedExam(owner.id, exam.id, { sheetFormat: "bubbles", numQuestions: 20 }),
    ]);
    assert.equal(race[1].status, "updated");
    assert.ok(["saved", "invalid"].includes(race[0].status));
    assert.equal(await getOwnedMatrixProfile(owner.id, exam.id), null);
    assert.equal((await db.select().from(answerKeyItems).where(eq(answerKeyItems.examId, exam.id))).length, 0);
    assert.equal((await updateOwnedExam(other.id, exam.id, { sheetFormat: "uax-grid-40" })).status, "not_found");
    assert.equal((await updateOwnedExam(owner.id, exam.id, { sheetFormat: "uax-grid-40" })).status, "invalid");
  } finally {
    await db.delete(users).where(eq(users.id, owner.id));
    await db.delete(users).where(eq(users.id, other.id));
  }
});
