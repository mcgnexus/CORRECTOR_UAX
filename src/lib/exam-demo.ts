import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { answerKeyItems, examResultAnswers, examResults, exams, examStudents, students, users } from "@/db/schema";
import { examDemo } from "./exam-demo-content";

export { examDemo, isDemoConfirmation } from "./exam-demo-content";

export function demoExamId(ownerId: string) {
  const hex = createHash("sha256").update(`corrector-uax:private-demo:v1:${ownerId}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function createOwnedDemo(ownerId: string) {
  return getDb().transaction(async (tx) => {
    // Serialize concurrent clicks/retries across all tabs of this account.
    const [owner] = await tx.select({ id: users.id }).from(users).where(eq(users.id, ownerId)).for("update");
    if (!owner) return { status: "not_found" as const };
    const id = demoExamId(ownerId);
    const [existing] = await tx.select({ id: exams.id }).from(exams)
      .where(and(eq(exams.id, id), eq(exams.ownerId, ownerId)));
    if (existing) return { status: "existing" as const, examId: existing.id };

    await tx.insert(exams).values({ id, ownerId, title: examDemo.title, subject: examDemo.subject,
      numQuestions: examDemo.numQuestions, numOptions: examDemo.numOptions, status: examDemo.status });
    await tx.insert(answerKeyItems).values(examDemo.key.map((item) => ({ ...item, examId: id, llmConfidence: null, editedByTeacher: true })));
    for (const fixture of examDemo.students) {
      const [profile] = await tx.insert(students).values({ ownerId, name: fixture.name, dni: null,
        groups: ["Ejemplo ficticio"], metadata: { origen: "Ejemplo ficticio de demostración" } }).returning({ id: students.id });
      const [enrollment] = await tx.insert(examStudents).values({ examId: id, studentId: profile.id,
        name: fixture.name, dni: null }).returning({ id: examStudents.id });
      if (!fixture.answers) continue;
      // Draft fixture submissions stay unscored until the teacher validates the key.
      await tx.insert(examResults).values({ studentId: enrollment.id });
      await tx.insert(examResultAnswers).values(fixture.answers.map((answer) => ({ studentId: enrollment.id,
        questionNo: answer.questionNo, selectedOption: answer.optionIndex })));
    }
    return { status: "created" as const, examId: id };
  });
}
