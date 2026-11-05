import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { answerKeyItems, examResults, examStudents, exams } from "@/db/schema";
import type { ExamInput } from "@/lib/validation";
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

export async function createOwnedExam(ownerId: string, values: ExamInput) {
  const [exam] = await getDb()
    .insert(exams)
    .values({ ...values, ownerId })
    .returning();
  return exam;
}

export async function updateOwnedExam(ownerId: string, examId: string, values: Partial<ExamInput>) {
  const db = getDb();
  const [current] = await db
    .select({ numQuestions: exams.numQuestions, numOptions: exams.numOptions })
    .from(exams)
    .where(and(eq(exams.ownerId, ownerId), eq(exams.id, examId)))
    .limit(1);
  if (!current) return { status: "not_found" as const };

  const cambiaEstructura =
    (values.numQuestions !== undefined && values.numQuestions !== current.numQuestions) ||
    (values.numOptions !== undefined && values.numOptions !== current.numOptions);

  if (!cambiaEstructura) {
    const [exam] = await db
      .update(exams)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(exams.ownerId, ownerId), eq(exams.id, examId)))
      .returning();
    return exam ? { status: "updated" as const, exam } : { status: "not_found" as const };
  }

  return db.transaction(async (tx) => {
    const locked = await tx.execute(sql`
      select id from exams where id = ${examId} and owner_id = ${ownerId} for update
    `);
    if (locked.length === 0) return { status: "not_found" as const };
    const savedResults = await tx
      .select({ studentId: examResults.studentId })
      .from(examResults)
      .innerJoin(examStudents, eq(examStudents.id, examResults.studentId))
      .where(eq(examStudents.examId, examId))
      .limit(1);
    if (savedResults.length > 0) return { status: "results_exist" as const };
    await tx.delete(answerKeyItems).where(eq(answerKeyItems.examId, examId));
    const [exam] = await tx
      .update(exams)
      .set({ ...values, status: "draft", updatedAt: new Date() })
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
