import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test, { after } from "node:test";
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "../../src/db";
import { validateTestDatabaseUrl } from "../../src/lib/database-url-safety";

after(closeDb);

test("backfill conserva UUID y documentos ambiguos sin fusionar ni romper unicidad", async () => {
  validateTestDatabaseUrl({ DATABASE_URL_TEST: process.env.DATABASE_URL, DATABASE_URL: process.env.DATABASE_URL_NORMAL });
  const migration = readFileSync("drizzle/0006_student_directory_profiles.sql", "utf8");
  const backfill = migration.slice(migration.indexOf("-- Backfill"));
  await getDb().transaction(async (tx) => {
    await tx.execute(sql.raw("CREATE TEMP TABLE students (LIKE public.students INCLUDING ALL) ON COMMIT DROP"));
    await tx.execute(sql.raw("CREATE TEMP TABLE exams (id uuid, owner_id uuid) ON COMMIT DROP"));
    await tx.execute(sql.raw("CREATE TEMP TABLE exam_students (id uuid PRIMARY KEY, exam_id uuid, name text, dni text, student_id uuid, UNIQUE(exam_id,student_id)) ON COMMIT DROP"));
    const owner = randomUUID(), exam = randomUUID(), exam2 = randomUUID();
    await tx.execute(sql`insert into exams (id,owner_id) values (${exam},${owner}),(${exam2},${owner})`);
    const ids = Array.from({ length: 5 }, () => randomUUID());
    await tx.execute(sql`insert into exam_students (id,exam_id,name,dni) values
      (${ids[0]},${exam},'Alumno Uno','12345678Z'),
      (${ids[1]},${exam},'Otro Alumno',' 12345678z '),
      (${ids[2]},${exam},'Legado','bad-document'),
      (${ids[3]},${exam},'Compartido','00000000T'),
      (${ids[4]},${exam2},'Compartido','00000000T')`);
    for (const statement of backfill.split("--> statement-breakpoint")) if (statement.trim()) await tx.execute(sql.raw(statement));
    const rows = await tx.execute(sql`select id,student_id,dni from exam_students order by id`);
    assert.equal(rows.length, 5); assert.ok(rows.every((r) => r.student_id));
    assert.notEqual(rows.find((r) => r.id === ids[0])?.student_id, rows.find((r) => r.id === ids[1])?.student_id);
    assert.equal(rows.find((r) => r.id === ids[3])?.student_id, rows.find((r) => r.id === ids[4])?.student_id);
    assert.equal(rows.find((r) => r.id === ids[2])?.dni, "bad-document");
    const before = await tx.execute(sql`select * from students order by id`);
    for (const statement of backfill.split("--> statement-breakpoint")) if (statement.trim()) await tx.execute(sql.raw(statement));
    assert.deepEqual(await tx.execute(sql`select * from students order by id`), before);
  });
});
