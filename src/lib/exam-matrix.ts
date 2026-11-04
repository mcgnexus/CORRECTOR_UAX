import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { examMatrixProfiles, exams } from "@/db/schema";
import { matrixProfileInputSchema, matrixProfileProblems } from "@/lib/matrix/profile";

export async function getOwnedMatrixProfile(ownerId: string, examId: string) {
  const [profile] = await getDb()
    .select({
      examId: examMatrixProfiles.examId,
      bubbles: examMatrixProfiles.bubbles,
      bubbleRadius: examMatrixProfiles.bubbleRadius,
      rowsPerBlock: examMatrixProfiles.rowsPerBlock,
      blocks: examMatrixProfiles.blocks,
      optionsPerBlock: examMatrixProfiles.optionsPerBlock,
      updatedAt: examMatrixProfiles.updatedAt,
    })
    .from(examMatrixProfiles)
    .innerJoin(exams, eq(exams.id, examMatrixProfiles.examId))
    .where(and(eq(exams.ownerId, ownerId), eq(examMatrixProfiles.examId, examId)))
    .limit(1);
  return profile ?? null;
}

export async function saveOwnedMatrixProfile(ownerId: string, examId: string, payload: unknown) {
  const parsed = matrixProfileInputSchema.safeParse(payload);
  if (!parsed.success) return { status: "invalid" as const, problems: ["La calibración no tiene un formato válido."] };

  return getDb().transaction(async (tx) => {
    const locked = await tx.execute(sql`
      select id, num_questions, num_options from exams
      where id = ${examId} and owner_id = ${ownerId}
      for update
    `);
    if (locked.length === 0) return { status: "not_found" as const };

    const [exam] = await tx
      .select({ numQuestions: exams.numQuestions, numOptions: exams.numOptions })
      .from(exams)
      .where(and(eq(exams.id, examId), eq(exams.ownerId, ownerId)))
      .limit(1);

    const problems = matrixProfileProblems(parsed.data, exam.numQuestions, exam.numOptions);
    if (problems.length > 0) return { status: "invalid" as const, problems };

    await tx
      .insert(examMatrixProfiles)
      .values({
        examId,
        bubbles: parsed.data.bubbles,
        bubbleRadius: parsed.data.bubbleRadius,
        rowsPerBlock: parsed.data.rowsPerBlock,
        blocks: parsed.data.blocks,
        optionsPerBlock: parsed.data.optionsPerBlock,
      })
      .onConflictDoUpdate({
        target: examMatrixProfiles.examId,
        set: {
          bubbles: parsed.data.bubbles,
          bubbleRadius: parsed.data.bubbleRadius,
          rowsPerBlock: parsed.data.rowsPerBlock,
          blocks: parsed.data.blocks,
          optionsPerBlock: parsed.data.optionsPerBlock,
          updatedAt: new Date(),
        },
      });

    return { status: "saved" as const };
  });
}

export async function deleteOwnedMatrixProfile(ownerId: string, examId: string) {
  const [owned] = await getDb()
    .select({ id: exams.id })
    .from(exams)
    .where(and(eq(exams.id, examId), eq(exams.ownerId, ownerId)))
    .limit(1);
  if (!owned) return { status: "not_found" as const };

  await getDb().delete(examMatrixProfiles).where(eq(examMatrixProfiles.examId, examId));
  return { status: "deleted" as const };
}
