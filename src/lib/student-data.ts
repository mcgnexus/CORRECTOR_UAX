import { z } from "zod";
import { normalizeStudent } from "./exam-roster";

const optionalText = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);
const schema = z.object({
  name: z.string(),
  dni: z.string().nullable().optional(),
  email: z.string().trim().toLowerCase().max(254).email().nullable().optional().or(z.literal("")),
  academicCode: optionalText(100),
  groups: z.array(z.string().trim().min(1).max(160)).max(50).default([]),
  metadata: z.custom<Record<string, string>>((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const entries = Object.entries(value);
    return entries.length <= 50 && entries.every(([key, text]) => key.length >= 1 && key.length <= 160 && typeof text === "string" && text.length <= 500);
  }).default({}),
}).strict();

export type DirectoryStudentInput = {
  name: string; dni: string | null; email: string | null; academicCode: string | null;
  groups: string[]; metadata: Record<string, string>;
};

export function withStudentImportSource(metadata: Record<string, string>, sheet: string, row: number) {
  let key = "Origen";
  let suffix = 2;
  while (Object.hasOwn(metadata, key)) key = `Origen (${suffix++})`;
  return { ...metadata, [key]: `${sheet}, fila ${row}` };
}

export function normalizeDirectoryStudent(input: unknown): { success: true; data: DirectoryStudentInput } | { success: false; message: string } {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { success: false, message: "Revisa los datos del alumno: correo, grupos y campos adicionales deben ser válidos y estar dentro de los límites." };
  const identity = normalizeStudent({ name: parsed.data.name, dni: parsed.data.dni });
  if (!identity.success) return identity;
  return { success: true, data: {
    ...identity.data, email: parsed.data.email || null, academicCode: parsed.data.academicCode,
    groups: [...new Set(parsed.data.groups)].sort(),
    metadata: Object.fromEntries(Object.entries(parsed.data.metadata).sort(([a], [b]) => a.localeCompare(b))),
  } };
}
