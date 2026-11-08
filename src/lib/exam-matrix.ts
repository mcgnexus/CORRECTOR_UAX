import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { examMatrixProfiles, exams } from "@/db/schema";
import { matrixProfileInputSchema, matrixProfileProblems, type MatrixProfileInput } from "@/lib/matrix/profile";

export async function getOwnedMatrixProfile(ownerId: string, examId: string): Promise<(MatrixProfileInput & { examId: string; updatedAt: Date }) | null> {
  const [profile] = await getDb()
    .select({
      examId: examMatrixProfiles.examId,
      bubbles: examMatrixProfiles.bubbles,
      bubbleRadius: examMatrixProfiles.bubbleRadius,
      rowsPerBlock: examMatrixProfiles.rowsPerBlock,
      blocks: examMatrixProfiles.blocks,
      optionsPerBlock: examMatrixProfiles.optionsPerBlock,
      updatedAt: examMatrixProfiles.updatedAt,
      format: examMatrixProfiles.format,
      version: examMatrixProfiles.version,
      uaxData: examMatrixProfiles.uaxData,
    })
    .from(examMatrixProfiles)
    .innerJoin(exams, eq(exams.id, examMatrixProfiles.examId))
    .where(and(eq(exams.ownerId, ownerId), eq(examMatrixProfiles.examId, examId), eq(exams.sheetFormat, examMatrixProfiles.format)))
    .limit(1);
  if (!profile) return null;
  const parsed = matrixProfileInputSchema.safeParse(profile.format === "uax-grid-40" ? {
    format: profile.format, version: profile.version, tables: profile.uaxData?.tables,
    rowsPerBlock: profile.rowsPerBlock, blocks: profile.blocks, optionsPerBlock: profile.optionsPerBlock,
  } : {
    format: profile.format, version: profile.version, bubbles: profile.bubbles, bubbleRadius: profile.bubbleRadius,
    rowsPerBlock: profile.rowsPerBlock, blocks: profile.blocks, optionsPerBlock: profile.optionsPerBlock,
  });
  return parsed.success ? { ...parsed.data, examId: profile.examId, updatedAt: profile.updatedAt } : null;
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
      .select({ numQuestions: exams.numQuestions, numOptions: exams.numOptions, sheetFormat: exams.sheetFormat })
      .from(exams)
      .where(and(eq(exams.id, examId), eq(exams.ownerId, ownerId)))
      .limit(1);

    const problems = matrixProfileProblems(parsed.data, exam.numQuestions, exam.numOptions, exam.sheetFormat);
    if (problems.length > 0) return { status: "invalid" as const, problems };

    const input = parsed.data;
    const data = {
      format: input.format ?? "bubbles" as const,
      version: 1,
      bubbles: input.format === "uax-grid-40" ? null : input.bubbles,
      bubbleRadius: input.format === "uax-grid-40" ? null : input.bubbleRadius,
      uaxData: input.format === "uax-grid-40" ? { tables: input.tables } : null,
      rowsPerBlock: input.rowsPerBlock, blocks: input.blocks, optionsPerBlock: input.optionsPerBlock,
    };
    await tx
      .insert(examMatrixProfiles)
      .values({
        examId,
        ...data,
      })
      .onConflictDoUpdate({
        target: examMatrixProfiles.examId,
        set: {
          ...data,
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
