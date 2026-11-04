import { z } from "zod";

export const MAX_EXAM_TEXT_CHARS = 100_000;

export const providerAnswerSchema = z.object({
  q: z.number().int().positive(),
  answer: z.string().regex(/^[A-Z]$/),
  confidence: z.number().finite().min(0).max(1),
}).strict();

const providerPayloadSchema = z.union([
  z.array(providerAnswerSchema),
  z.object({ answers: z.array(providerAnswerSchema) }).strict().transform((payload) => payload.answers),
]);

export type ProviderAnswer = z.infer<typeof providerAnswerSchema>;

export const generateKeyRequestSchema = z.object({
  text: z.string().trim().min(1).max(MAX_EXAM_TEXT_CHARS),
});

export function parseProviderAnswerKey(content: string, numQuestions: number, numOptions: number) {
  let payload: unknown;
  try {
    payload = JSON.parse(content);
  } catch {
    return { success: false as const, error: "La respuesta del modelo no es JSON válido." };
  }

  const parsed = providerPayloadSchema.safeParse(payload);
  if (!parsed.success) return { success: false as const, error: "La respuesta no cumple el esquema de clave." };

  const answers = parsed.data;
  const seen = new Set<number>();
  const maxOption = String.fromCharCode(64 + numOptions);
  for (const answer of answers) {
    if (answer.q > numQuestions || seen.has(answer.q)) {
      return { success: false as const, error: "La clave contiene preguntas fuera de rango o repetidas." };
    }
    if (answer.answer > maxOption) {
      return { success: false as const, error: "La clave contiene opciones fuera del examen." };
    }
    seen.add(answer.q);
  }

  if (answers.length !== numQuestions || seen.size !== numQuestions) {
    return { success: false as const, error: "La clave está incompleta." };
  }

  return { success: true as const, data: answers.toSorted((a, b) => a.q - b.q) };
}

export function createAnswerKeyDraftSchema(numQuestions: number, numOptions: number) {
  const maxOption = String.fromCharCode(64 + numOptions);
  return z
    .object({
      answers: z
        .array(
          z
            .object({
              q: z.number().int().min(1).max(numQuestions),
              answer: z.string().regex(/^[A-Z]$/),
              confidence: z.number().finite().min(0).max(1).nullable().default(null),
              editedByTeacher: z.boolean().default(false),
            })
            .strict()
            .refine((answer) => answer.answer <= maxOption, { message: "Opción fuera del rango del examen." }),
        )
        .max(numQuestions),
    })
    .strict()
    .refine((draft) => new Set(draft.answers.map((answer) => answer.q)).size === draft.answers.length, {
      message: "Hay preguntas repetidas.",
      path: ["answers"],
    });
}

export function answerKeyProblems(
  answers: Array<{ q: number; answer: string }>,
  numQuestions: number,
  numOptions: number,
) {
  const problems: string[] = [];
  const seen = new Set<number>();
  const maxOption = String.fromCharCode(64 + numOptions);

  for (const item of answers) {
    if (item.q < 1 || item.q > numQuestions || seen.has(item.q)) {
      problems.push("La clave contiene preguntas repetidas o fuera de rango.");
      continue;
    }
    if (!/^[A-Z]$/.test(item.answer) || item.answer > maxOption) {
      problems.push(`La respuesta de la pregunta ${item.q} no es una opción válida.`);
    }
    seen.add(item.q);
  }

  if (seen.size !== numQuestions) problems.push("Debe haber exactamente una respuesta por pregunta.");
  return [...new Set(problems)];
}

export function parseAnswerKeyPayload(payload: unknown, numQuestions: number, numOptions: number) {
  const parsed = createAnswerKeyDraftSchema(numQuestions, numOptions).safeParse(payload);
  if (!parsed.success) return { success: false as const, error: "La clave contiene respuestas inválidas o repetidas." };
  return { success: true as const, data: parsed.data };
}
