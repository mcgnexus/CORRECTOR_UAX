import { z } from "zod";

const normalizedEmail = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());

export const registrationSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: normalizedEmail,
  password: z.string().min(12).max(128),
});

export const credentialsSchema = z.object({
  email: normalizedEmail,
  password: z.string().min(1).max(128),
});

const examFieldsSchema = z.object({
  title: z.string().trim().min(1).max(160),
  subject: z.string().trim().max(160).nullish(),
  numQuestions: z.coerce.number().int().min(1).max(100),
  numOptions: z.coerce.number().int().min(2).max(26),
});

export const examCreateSchema = examFieldsSchema
  .extend({
    subject: z.string().trim().max(160).optional().transform((value) => value || null),
    numOptions: examFieldsSchema.shape.numOptions.default(4),
  })
  .transform((value) => ({ ...value, subject: value.subject ?? null }));

export const examUpdateSchema = examFieldsSchema
  .partial()
  .refine(
    (value) =>
      value.title !== undefined ||
      value.subject !== undefined ||
      value.numQuestions !== undefined ||
      value.numOptions !== undefined,
    { message: "Indica al menos un campo que modificar." },
  )
  .transform((value) => {
    const cambios: Partial<ExamInput> = {};
    if (value.title !== undefined) cambios.title = value.title;
    if (value.subject !== undefined) cambios.subject = value.subject || null;
    if (value.numQuestions !== undefined) cambios.numQuestions = value.numQuestions;
    if (value.numOptions !== undefined) cambios.numOptions = value.numOptions;
    return cambios;
  });

export type ExamInput = z.infer<typeof examCreateSchema>;
