import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { answerKeyItems, examResultAnswers, examResults, examStudents, exams, scoringRules } from "@/db/schema";
import { answerKeyProblems } from "@/lib/answer-key";
import { calculateScore, DEFAULT_SCORING_RULE, validateScoringRule, type ScoringRule } from "@/lib/scoring";

type DbTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export async function getOwnedScoringRule(ownerId: string, examId: string) {
  const [row] = await getDb()
    .select({
      status: exams.status,
      pointsCorrect: scoringRules.pointsCorrect,
      pointsWrong: scoringRules.pointsWrong,
      pointsBlank: scoringRules.pointsBlank,
      maxScore: scoringRules.maxScore,
    })
    .from(exams)
    .leftJoin(scoringRules, eq(scoringRules.examId, exams.id))
    .where(and(eq(exams.ownerId, ownerId), eq(exams.id, examId)))
    .limit(1);
  if (!row) return undefined;
  return {
    status: row.status,
    rule: row.pointsCorrect === null ? DEFAULT_SCORING_RULE : {
      pointsCorrect: row.pointsCorrect,
      pointsWrong: row.pointsWrong!,
      pointsBlank: row.pointsBlank!,
      maxScore: row.maxScore!,
    },
  };
}

export async function getScoringRuleInTransaction(tx: DbTransaction, examId: string): Promise<ScoringRule> {
  const [row] = await tx.select().from(scoringRules).where(eq(scoringRules.examId, examId)).limit(1);
  return row ? {
    pointsCorrect: row.pointsCorrect,
    pointsWrong: row.pointsWrong,
    pointsBlank: row.pointsBlank,
    maxScore: row.maxScore,
  } : DEFAULT_SCORING_RULE;
}

export async function invalidateExamResults(tx: DbTransaction, examId: string) {
  const updated = await tx.execute(sql`
    update exam_results r
    set correct = null, wrong = null, blank = null, raw_score = null, score = null, version = version + 1
    from exam_students s
    where s.id = r.student_id and s.exam_id = ${examId}
  `);
  return updated.count;
}

export async function recalculateExamResults(
  tx: DbTransaction,
  examId: string,
  numQuestions: number,
  numOptions: number,
  answerKey: Array<{ questionNo: number; correctOption: string }>,
  rule: ScoringRule,
) {
  const results = await tx
    .select({ studentId: examResults.studentId })
    .from(examResults)
    .innerJoin(examStudents, eq(examStudents.id, examResults.studentId))
    .where(eq(examStudents.examId, examId));
  if (!results.length) return 0;
  const answers = await tx
    .select({ studentId: examResultAnswers.studentId, questionNo: examResultAnswers.questionNo, optionIndex: examResultAnswers.selectedOption })
    .from(examResultAnswers)
    .innerJoin(examStudents, eq(examStudents.id, examResultAnswers.studentId))
    .where(eq(examStudents.examId, examId));
  const byStudent = new Map<string, Array<{ questionNo: number; optionIndex: number | null }>>();
  for (const answer of answers) {
    const list = byStudent.get(answer.studentId) ?? [];
    list.push({ questionNo: answer.questionNo, optionIndex: answer.optionIndex });
    byStudent.set(answer.studentId, list);
  }
  for (const result of results) {
    const scored = calculateScore({
      answers: byStudent.get(result.studentId) ?? [],
      answerKey,
      numQuestions,
      numOptions,
      rule,
    });
    if (!scored.success) throw new Error("No se pudo recalcular una entrega guardada.");
    await tx.update(examResults).set({ ...scored.summary, version: sql`${examResults.version} + 1` }).where(eq(examResults.studentId, result.studentId));
  }
  return results.length;
}

export async function saveOwnedScoringRule(ownerId: string, examId: string, value: unknown) {
  const parsed = validateScoringRule(value);
  if (!parsed.success) return { status: "invalid" as const, message: parsed.message };
  return getDb().transaction(async (tx) => {
    const locked = await tx.execute(sql`select id from exams where id = ${examId} and owner_id = ${ownerId} for update`);
    if (locked.length === 0) return { status: "not_found" as const };
    const [exam] = await tx
      .select({ status: exams.status, numQuestions: exams.numQuestions, numOptions: exams.numOptions })
      .from(exams)
      .where(and(eq(exams.id, examId), eq(exams.ownerId, ownerId)))
      .limit(1);
    if (!exam) return { status: "not_found" as const };
    const key = exam.status === "key_validated"
      ? await tx.select({ questionNo: answerKeyItems.questionNo, correctOption: answerKeyItems.correctOption }).from(answerKeyItems).where(eq(answerKeyItems.examId, examId))
      : [];
    if (exam.status === "key_validated" && answerKeyProblems(key.map((item) => ({ q: item.questionNo, answer: item.correctOption })), exam.numQuestions, exam.numOptions).length) {
      return { status: "key_invalid" as const };
    }
    await tx.insert(scoringRules).values({ examId, ...parsed.rule, updatedAt: new Date() }).onConflictDoUpdate({
      target: scoringRules.examId,
      set: { ...parsed.rule, updatedAt: new Date() },
    });
    let recalculated = 0;
    if (exam.status === "key_validated") {
      recalculated = await recalculateExamResults(tx, examId, exam.numQuestions, exam.numOptions, key, parsed.rule);
    }
    return { status: "saved" as const, recalculated, rule: parsed.rule, keyValidated: exam.status === "key_validated" };
  });
}
