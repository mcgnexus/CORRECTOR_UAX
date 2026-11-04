import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { exams } from "@/db/schema";
import type { ExamInput } from "@/lib/validation";

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
  const [exam] = await getDb()
    .update(exams)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(exams.ownerId, ownerId), eq(exams.id, examId)))
    .returning();
  return exam;
}

export async function deleteOwnedExam(ownerId: string, examId: string) {
  const [exam] = await getDb()
    .delete(exams)
    .where(and(eq(exams.ownerId, ownerId), eq(exams.id, examId)))
    .returning({ id: exams.id });
  return exam;
}
