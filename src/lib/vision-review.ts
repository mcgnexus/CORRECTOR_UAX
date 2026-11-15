import { z } from "zod";

export function visionReview(input: unknown, numQuestions: number) {
  const answer = z.object({
    questionNo: z.number().int().min(1).max(numQuestions),
    selectedOption: z.number().int().min(0).max(3).nullable(),
    flag: z.enum(["ok", "blank", "multiple", "faint"]),
  }).strict().refine((a) => a.flag === "ok" ? a.selectedOption !== null : a.selectedOption === null);

  const response = z.object({ answers: z.array(answer).length(numQuestions) }).strict().refine(
    ({ answers }) => new Set(answers.map((a) => a.questionNo)).size === numQuestions,
  );

  const { answers } = response.parse(input);
  return answers.sort((a, b) => a.questionNo - b.questionNo).map((a) => ({
    q: a.questionNo,
    detected: a.selectedOption,
    selectedOption: a.selectedOption,
    flag: a.flag,
    confidence: null,
    confirmed: false,
    unresolved: a.flag === "multiple" || a.flag === "faint",
  }));
}
