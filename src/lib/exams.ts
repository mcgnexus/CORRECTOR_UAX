import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { answerKeyItems, examMatrixProfiles, examResults, examStudents, exams } from "@/db/schema";
import { examCreateSchema, type ExamInput } from "@/lib/validation";
import { isAdminUser } from "@/lib/access";

export async function listAccessibleExams(userId: string) {
  if (await isAdminUser(userId)) {
    return getDb().select().from(exams).orderBy(desc(exams.updatedAt));
  }
  return listOwnedExams(userId);
}

export async function listOwnedExams(ownerId: string) {
  return getDb()
    .select()
    .from(exams)
    .where(eq(exams.ownerId, ownerId))
    .orderBy(desc(exams.updatedAt));
}

export async function findOwnedExam(ownerId: string, examId: string) {
  const [exam] = await getDb()
    .select()
    .from(exams)
    .where(and(eq(exams.ownerId, ownerId), eq(exams.id, examId)))
    .limit(1);
  return exam;
}

export async function createOwnedExam(ownerId: string, values: Omit<ExamInput, "sheetFormat"> & Partial<Pick<ExamInput, "sheetFormat">>) {
  const [exam] = await getDb()
    .insert(exams)
    .values({ ...examCreateSchema.parse(values), ownerId })
    .returning();
  return exam;
}

export async function updateOwnedExam(ownerId: string, examId: string, values: Partial<ExamInput>) {
  return getDb().transaction(async (tx) => {
    const locked = await tx.execute(sql`
      select id from exams where id = ${examId} and owner_id = ${ownerId} for update
    `);
    if (locked.length === 0) return { status: "not_found" as const };
    const [current] = await tx.select().from(exams).where(eq(exams.id, examId)).limit(1);
    const parsed = examCreateSchema.safeParse({ ...current, ...values });
    if (!parsed.success) return { status: "invalid" as const };
    const dimensionsChanged = parsed.data.numQuestions !== current.numQuestions || parsed.data.numOptions !== current.numOptions;
    const structureChanged = dimensionsChanged || parsed.data.sheetFormat !== current.sheetFormat;
    if (structureChanged) {
      const savedResults = await tx
      .select({ studentId: examResults.studentId })
      .from(examResults)
      .innerJoin(examStudents, eq(examStudents.id, examResults.studentId))
      .where(eq(examStudents.examId, examId))
      .limit(1);
      if (savedResults.length > 0) return { status: "results_exist" as const };
      await tx.delete(examMatrixProfiles).where(eq(examMatrixProfiles.examId, examId));
    }
    if (dimensionsChanged) await tx.delete(answerKeyItems).where(eq(answerKeyItems.examId, examId));
    const [exam] = await tx
      .update(exams)
      .set({ ...parsed.data, ...(structureChanged ? { structureVersion: current.structureVersion + 1 } : {}), ...(dimensionsChanged ? { status: "draft" as const } : {}), updatedAt: new Date() })
      .where(and(eq(exams.ownerId, ownerId), eq(exams.id, examId)))
      .returning();
    return exam ? { status: "updated" as const, exam } : { status: "not_found" as const };
  });
}

export async function deleteOwnedExam(ownerId: string, examId: string) {
  const [exam] = await getDb()
    .delete(exams)
    .where(and(eq(exams.ownerId, ownerId), eq(exams.id, examId)))
    .returning({ id: exams.id });
  return exam;
}
