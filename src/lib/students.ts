import { createHash } from "node:crypto";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { getDb } from "@/db";
import { exams, examStudents, studentImports, students, users } from "@/db/schema";
import { normalizeDirectoryStudent, type DirectoryStudentInput } from "./student-data";

type Transaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export async function lockDirectory(tx: Transaction, ownerId: string) {
  return (await tx.select({ id: users.id }).from(users).where(eq(users.id, ownerId)).for("update")).length > 0;
}

export async function listDirectoryStudents(ownerId: string) {
  return getDb().select().from(students).where(eq(students.ownerId, ownerId)).orderBy(asc(students.name), asc(students.id));
}

export async function createDirectoryStudent(ownerId: string, input: unknown) {
  const parsed = normalizeDirectoryStudent(input);
  if (!parsed.success) return { status: "invalid" as const, message: parsed.message };
  return getDb().transaction(async (tx) => {
    if (!await lockDirectory(tx, ownerId)) return { status: "not_found" as const };
    const [student] = await tx.insert(students).values({ ownerId, ...parsed.data }).onConflictDoNothing().returning();
    return student ? { status: "created" as const, student } : { status: "duplicate" as const };
  });
}

export async function updateDirectoryStudent(ownerId: string, studentId: string, input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((k) => !["name", "dni", "email", "academicCode", "groups", "metadata", "expectedVersion"].includes(k))) {
    return { status: "invalid" as const, message: "Datos no válidos." };
  }
  const { expectedVersion, ...changes } = input as Record<string, unknown>;
  if (!Number.isInteger(expectedVersion) || (expectedVersion as number) < 1) return { status: "invalid" as const, message: "Falta la versión original de la ficha. Recarga los datos antes de editar." };
  return getDb().transaction(async (tx) => {
    if (!await lockDirectory(tx, ownerId)) return { status: "not_found" as const };
    const [current] = await tx.select().from(students).where(and(eq(students.ownerId, ownerId), eq(students.id, studentId)));
    if (!current) return { status: "not_found" as const };
    if (current.version !== expectedVersion) return { status: "conflict" as const };
    const parsed = normalizeDirectoryStudent({ name: current.name, dni: current.dni, email: current.email, academicCode: current.academicCode, groups: current.groups, metadata: current.metadata, ...changes });
    if (!parsed.success) return { status: "invalid" as const, message: parsed.message };
    const identities = [parsed.data.dni ? eq(students.dni, parsed.data.dni) : undefined, parsed.data.academicCode ? eq(students.academicCode, parsed.data.academicCode) : undefined].filter((v) => v !== undefined);
    if (identities.length) {
      const matches = await tx.select({ id: students.id }).from(students).where(and(eq(students.ownerId, ownerId), or(...identities)));
      if (matches.some((s) => s.id !== studentId)) return { status: "duplicate" as const };
    }
    const [student] = await tx.update(students).set({ ...parsed.data, version: current.version + 1, updatedAt: new Date() }).where(eq(students.id, studentId)).returning();
    return { status: "updated" as const, student };
  });
}

export async function deleteDirectoryStudent(ownerId: string, studentId: string, confirmed: boolean) {
  if (!confirmed) return { status: "confirmation_required" as const };
  return getDb().transaction(async (tx) => {
    if (!await lockDirectory(tx, ownerId)) return { status: "not_found" as const };
    const deleted = await tx.delete(students).where(and(eq(students.ownerId, ownerId), eq(students.id, studentId))).returning({ id: students.id });
    return { status: deleted.length ? "deleted" as const : "not_found" as const };
  });
}

export async function assignDirectoryStudents(ownerId: string, examId: string, ids: string[]) {
  if (!ids.length || ids.length > 1000 || ids.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) return { status: "invalid" as const, message: "Selecciona de 1 a 1000 alumnos válidos." };
  return getDb().transaction(async (tx) => {
    if (!await lockDirectory(tx, ownerId)) return { status: "not_found" as const };
    const [exam] = await tx.select({ id: exams.id }).from(exams).where(and(eq(exams.id, examId), eq(exams.ownerId, ownerId))).for("update");
    if (!exam) return { status: "not_found" as const };
    const rows = await tx.select().from(students).where(and(eq(students.ownerId, ownerId), inArray(students.id, [...new Set(ids)])));
    if (rows.length !== new Set(ids).size) return { status: "not_found" as const };
    const existing = await tx.select().from(examStudents).where(eq(examStudents.examId, examId));
    const pending = rows.filter((s) => !existing.some((e) => e.studentId === s.id));
    if (pending.some((s) => s.dni && existing.some((e) => e.dni === s.dni))) return { status: "conflict" as const, message: "Ya hay una inscripción con ese DNI. Revisa los datos antes de asignar; no se ha fusionado ningún alumno." };
    if (pending.length) await tx.insert(examStudents).values(pending.map((s) => ({ examId, studentId: s.id, name: s.name, dni: s.dni })));
    return { status: "assigned" as const, count: pending.length };
  });
}

export async function importDirectoryStudents(ownerId: string, input: unknown, acknowledgeUnidentified: boolean) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 1000) return { status: "invalid" as const, message: "Selecciona de 1 a 1000 alumnos." };
  const records: DirectoryStudentInput[] = [];
  for (const row of input) {
    const parsed = normalizeDirectoryStudent(row);
    if (!parsed.success) return { status: "invalid" as const, message: parsed.message };
    records.push(parsed.data);
  }
  const fingerprint = createHash("sha256").update(JSON.stringify(records)).digest("hex");
  return getDb().transaction(async (tx) => {
    if (!await lockDirectory(tx, ownerId)) return { status: "not_found" as const };
    const [previous] = await tx.select().from(studentImports).where(and(eq(studentImports.ownerId, ownerId), eq(studentImports.fingerprint, fingerprint)));
    if (previous) return { status: "imported" as const, count: previous.count, replayed: true };
    const current = await tx.select().from(students).where(eq(students.ownerId, ownerId));
    const documents = new Set(current.flatMap((s) => s.dni ? [s.dni] : []));
    const codes = new Set(current.flatMap((s) => s.academicCode ? [s.academicCode] : []));
    for (const record of records) {
      if ((record.dni && documents.has(record.dni)) || (record.academicCode && codes.has(record.academicCode))) {
        return { status: "conflict" as const, message: "Hay DNI o códigos académicos ya registrados o repetidos en el lote. Omite esas filas o revisa la ficha existente; no se ha importado ningún alumno." };
      }
      if (record.dni) documents.add(record.dni);
      if (record.academicCode) codes.add(record.academicCode);
    }
    if (!acknowledgeUnidentified && records.some((s) => (!s.dni && !s.academicCode) || current.some((c) => c.name.toLocaleLowerCase("es") === s.name.toLocaleLowerCase("es")))) {
      return { status: "confirmation_required" as const, message: "Hay alumnos sin identificador o posibles homónimos. Confirma que has revisado las filas: se crearán fichas independientes, sin fusionarlas por nombre o correo." };
    }
    await tx.insert(students).values(records.map((s) => ({ ownerId, ...s })));
    await tx.insert(studentImports).values({ ownerId, fingerprint, count: records.length });
    return { status: "imported" as const, count: records.length, replayed: false };
  });
}
