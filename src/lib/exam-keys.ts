import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { answerKeyItems, exams } from "@/db/schema";
import { answerKeyProblems, parseAnswerKeyPayload } from "@/lib/answer-key";
import { getScoringRuleInTransaction, invalidateExamResults, recalculateExamResults } from "@/lib/exam-scoring";

export async function listOwnedAnswerKey(ownerId: string, examId: string) {
  return getDb()
    .select({
      questionNo: answerKeyItems.questionNo,
      correctOption: answerKeyItems.correctOption,
      llmConfidence: answerKeyItems.llmConfidence,
      editedByTeacher: answerKeyItems.editedByTeacher,
    })
    .from(answerKeyItems)
    .innerJoin(exams, eq(answerKeyItems.examId, exams.id))
    .where(and(eq(exams.ownerId, ownerId), eq(answerKeyItems.examId, examId)))
    .orderBy(asc(answerKeyItems.questionNo));
}

export async function saveOwnedAnswerKeyDraft(ownerId: string, examId: string, payload: unknown) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const locked = await tx.execute(sql`
      select id from exams
      where id = ${examId} and owner_id = ${ownerId}
      for update
    `);
    if (locked.length === 0) return { status: "not_found" as const };

    const [exam] = await tx
      .select({ numQuestions: exams.numQuestions, numOptions: exams.numOptions })
      .from(exams)
      .where(and(eq(exams.id, examId), eq(exams.ownerId, ownerId)))
      .limit(1);
    if (!exam) return { status: "not_found" as const };

    const parsed = parseAnswerKeyPayload(payload, exam.numQuestions, exam.numOptions);
    if (!parsed.success) return { status: "invalid" as const, message: parsed.error };

    await tx.delete(answerKeyItems).where(eq(answerKeyItems.examId, examId));
    if (parsed.data.answers.length > 0) {
      await tx.insert(answerKeyItems).values(
        parsed.data.answers.map((answer) => ({
          examId,
          questionNo: answer.q,
          correctOption: answer.answer,
          llmConfidence: answer.confidence,
          editedByTeacher: answer.editedByTeacher,
        })),
      );
    }
    await tx
      .update(exams)
      .set({ status: "key_pending", updatedAt: new Date() })
      .where(and(eq(exams.id, examId), eq(exams.ownerId, ownerId)));
    await invalidateExamResults(tx, examId);
    return { status: "saved" as const };
  });
}

export async function validateOwnedAnswerKey(ownerId: string, examId: string) {
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
    const answers = await tx
      .select({ q: answerKeyItems.questionNo, answer: answerKeyItems.correctOption })
      .from(answerKeyItems)
      .where(eq(answerKeyItems.examId, examId))
      .orderBy(asc(answerKeyItems.questionNo));

    const problems = answerKeyProblems(answers, exam.numQuestions, exam.numOptions);
    if (problems.length > 0) return { status: "invalid" as const, problems };

    const rule = await getScoringRuleInTransaction(tx, examId);
    const recalculated = await recalculateExamResults(
      tx,
      examId,
      exam.numQuestions,
      exam.numOptions,
      answers.map((answer) => ({ questionNo: answer.q, correctOption: answer.answer })),
      rule,
    );

    await tx
      .update(exams)
      .set({ status: "key_validated", updatedAt: new Date() })
      .where(and(eq(exams.id, examId), eq(exams.ownerId, ownerId)));
    return { status: "validated" as const, recalculated };
  });
}
