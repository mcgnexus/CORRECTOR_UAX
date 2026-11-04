import { z } from "zod";

export const matrixBubbleSchema = z.object({
  questionNo: z.number().int().min(1).max(100),
  optionIndex: z.number().int().min(0).max(25),
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
});

export const matrixProfileInputSchema = z
  .object({
    bubbles: z.array(matrixBubbleSchema).min(1).max(2600),
    bubbleRadius: z.number().finite().min(0.001).max(0.2),
    rowsPerBlock: z.number().int().min(1).max(100),
    blocks: z.number().int().min(1).max(2),
    optionsPerBlock: z.number().int().min(2).max(26),
  })
  .strict();

export type MatrixProfileInput = z.infer<typeof matrixProfileInputSchema>;

export function matrixProfileProblems(
  input: MatrixProfileInput,
  numQuestions: number,
  numOptions: number,
) {
  const problems: string[] = [];
  if (input.blocks !== 2) problems.push("La matriz debe tener dos bloques.");
  if (input.optionsPerBlock !== numOptions) {
    problems.push(`La matriz tiene ${input.optionsPerBlock} opciones por bloque y el examen ${numOptions}.`);
  }
  if (input.rowsPerBlock !== Math.ceil(numQuestions / 2)) {
    problems.push(`La matriz tiene ${input.rowsPerBlock} filas por bloque y el examen espera ${Math.ceil(numQuestions / 2)}.`);
  }

  const expected = numQuestions * numOptions;
  if (input.bubbles.length !== expected) {
    problems.push(`Se esperaban ${expected} burbujas y se recibieron ${input.bubbles.length}.`);
  }

  const seen = new Set<string>();
  for (const bubble of input.bubbles) {
    if (bubble.questionNo > numQuestions) {
      problems.push("Hay burbujas de preguntas fuera del rango del examen.");
      break;
    }
    if (bubble.optionIndex >= numOptions) {
      problems.push("Hay burbujas de opciones fuera del rango del examen.");
      break;
    }
    const key = `${bubble.questionNo}:${bubble.optionIndex}`;
    if (seen.has(key)) {
      problems.push("Hay burbujas repetidas.");
      break;
    }
    seen.add(key);
  }

  return [...new Set(problems)];
}
