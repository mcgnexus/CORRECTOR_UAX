import { z } from "zod";

export const matrixBubbleSchema = z.object({
  questionNo: z.number().int().min(1).max(100),
  optionIndex: z.number().int().min(0).max(25),
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
});

export const sheetFormatSchema = z.enum(["bubbles", "uax-grid-40"]);
export type SheetFormat = z.infer<typeof sheetFormatSchema>;

const bubbleMatrixProfileSchema = z
  .object({
    format: z.literal("bubbles").optional(),
    version: z.literal(1).optional(),
    bubbles: z.array(matrixBubbleSchema).min(1).max(2600),
    bubbleRadius: z.number().finite().min(0.001).max(0.2),
    rowsPerBlock: z.number().int().min(1).max(100),
    blocks: z.number().int().min(1).max(2),
    optionsPerBlock: z.number().int().min(2).max(26),
  })
  .strict();

export type BubbleMatrixProfile = z.infer<typeof bubbleMatrixProfileSchema>;

const normalizedPointSchema = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
}).strict();

const uaxTableSchema = z.object({
  corners: z.tuple([normalizedPointSchema, normalizedPointSchema, normalizedPointSchema, normalizedPointSchema])
    .refine((points) => points.every((a, i) => {
      const b = points[(i + 1) % 4];
      const c = points[(i + 2) % 4];
      return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) > 1e-8;
    }), "Las esquinas deben formar una tabla convexa no degenerada."),
  // 320 * 880 grayscale bytes, canonical base64, validated before decoding.
  reference: z.string().length(375468).regex(/^[A-Za-z0-9+/]{375466}[AEIMQUYcgkosw048]=$/),
}).strict();

const uaxGridProfileSchema = z.object({
  format: z.literal("uax-grid-40"),
  version: z.literal(1),
  tables: z.tuple([uaxTableSchema, uaxTableSchema]).refine(([left, right]) =>
    Math.max(...left.corners.map((point) => point.x)) < Math.min(...right.corners.map((point) => point.x)),
  "Las tablas deben estar ordenadas de izquierda a derecha y no solaparse."),
  rowsPerBlock: z.literal(20),
  blocks: z.literal(2),
  optionsPerBlock: z.literal(4),
}).strict();

export type UaxGridProfile = z.infer<typeof uaxGridProfileSchema>;
export const matrixProfileInputSchema = z.union([bubbleMatrixProfileSchema, uaxGridProfileSchema]);
export type MatrixProfileInput = z.infer<typeof matrixProfileInputSchema>;

export function matrixProfileProblems(
  input: MatrixProfileInput,
  numQuestions: number,
  numOptions: number,
  sheetFormat: SheetFormat = "bubbles",
) {
  const problems: string[] = [];
  if ((input.format ?? "bubbles") !== sheetFormat) problems.push("La calibracion no corresponde al formato del examen.");
  if (input.format === "uax-grid-40") {
    if (numQuestions !== 40 || numOptions !== 4) problems.push("UAX requiere 40 preguntas y cuatro opciones.");
    return problems;
  }
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
