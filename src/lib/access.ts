import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { exams, users } from "@/db/schema";

export type ExamAccess = { ownerId: string; isAdmin: boolean };

export async function isAdminUser(userId: string) {
  const [user] = await getDb().select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  return user?.role === "admin";
}

export async function resolveExamAccess(userId: string, examId: string): Promise<ExamAccess | undefined> {
  const [exam] = await getDb().select({ ownerId: exams.ownerId }).from(exams).where(eq(exams.id, examId)).limit(1);
  if (!exam) return undefined;
  if (exam.ownerId === userId) return { ownerId: exam.ownerId, isAdmin: false };
  if (!(await isAdminUser(userId))) return undefined;
  return { ownerId: exam.ownerId, isAdmin: true };
}
