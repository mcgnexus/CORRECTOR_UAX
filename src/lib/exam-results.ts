import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { answerKeyItems, examResultAnswers, examResults, exams, examStudents, idempotencyKeys, students as directoryStudents } from "@/db/schema";
import { answerKeyProblems } from "@/lib/answer-key";
import { getScoringRuleInTransaction } from "@/lib/exam-scoring";
import { hashReviewedRequest } from "@/lib/idempotency";
import { normalizeStudent, parseRosterCsv, validateReviewedAnswers } from "@/lib/exam-roster";
import { calculateScore } from "@/lib/scoring";
import { lockDirectory } from "@/lib/students";

export async function listOwnedExamRoster(ownerId: string, examId: string) {
  const db = getDb();
  const students = await db
    .select({
      id: examStudents.id,
      name: examStudents.name,
      dni: examStudents.dni,
      createdAt: examStudents.createdAt,
      savedAt: examResults.savedAt,
      correct: examResults.correct,
      wrong: examResults.wrong,
      blank: examResults.blank,
      rawScore: examResults.rawScore,
      score: examResults.score,
      version: examResults.version,
    })
    .from(examStudents)
    .innerJoin(exams, eq(exams.id, examStudents.examId))
    .leftJoin(examResults, eq(examResults.studentId, examStudents.id))
    .where(and(eq(exams.ownerId, ownerId), eq(examStudents.examId, examId)))
    .orderBy(asc(examStudents.name), asc(examStudents.dni));
  if (students.length === 0) return [];

  const answers = await db
    .select({ studentId: examResultAnswers.studentId, questionNo: examResultAnswers.questionNo, optionIndex: examResultAnswers.selectedOption })
    .from(examResultAnswers)
    .innerJoin(examStudents, eq(examStudents.id, examResultAnswers.studentId))
    .innerJoin(exams, eq(exams.id, examStudents.examId))
    .where(and(eq(exams.ownerId, ownerId), eq(examStudents.examId, examId)))
    .orderBy(asc(examResultAnswers.questionNo));
  const byStudent = new Map<string, Array<{ questionNo: number; optionIndex: number | null }>>();
  for (const answer of answers) {
    const list = byStudent.get(answer.studentId) ?? [];
    list.push({ questionNo: answer.questionNo, optionIndex: answer.optionIndex });
    byStudent.set(answer.studentId, list);
  }
  return students.map((student) => ({ ...student, answers: student.savedAt ? byStudent.get(student.id) ?? [] : null }));
}

export async function createOwnedStudent(ownerId: string, examId: string, input: unknown) {
  const normalized = normalizeStudent(input);
  if (!normalized.success) return { status: "invalid" as const, message: normalized.message };
  return getDb().transaction(async (tx) => {
    if (!await lockDirectory(tx, ownerId)) return { status: "not_found" as const };
    const locked = await tx.execute(sql`select id from exams where id = ${examId} and owner_id = ${ownerId} for update`);
    if (locked.length === 0) return { status: "not_found" as const };
    if (normalized.data.dni) {
      const [existing] = await tx.select({ id: examStudents.id }).from(examStudents).where(and(eq(examStudents.examId, examId), eq(examStudents.dni, normalized.data.dni)));
      if (existing) return { status: "duplicate" as const };
    }
    let directory = normalized.data.dni ? (await tx.select().from(directoryStudents).where(and(eq(directoryStudents.ownerId, ownerId), eq(directoryStudents.dni, normalized.data.dni))))[0] : undefined;
    directory ??= (await tx.insert(directoryStudents).values({ ownerId, ...normalized.data }).returning())[0];
    const [linked] = await tx.select({ id: examStudents.id }).from(examStudents).where(and(eq(examStudents.examId, examId), eq(examStudents.studentId, directory.id)));
    if (linked) return { status: "duplicate" as const };
    const [student] = await tx
      .insert(examStudents)
      .values({ examId, studentId: directory.id, ...normalized.data })
      .onConflictDoNothing({ target: [examStudents.examId, examStudents.dni] })
      .returning({ id: examStudents.id, name: examStudents.name, dni: examStudents.dni });
    return student ? { status: "created" as const, student } : { status: "duplicate" as const };
  });
}

export async function importOwnedStudents(ownerId: string, examId: string, csv: unknown) {
  const parsed = parseRosterCsv(csv);
  if (!parsed.success) return { status: "invalid" as const, problems: parsed.problems };
  return getDb().transaction(async (tx) => {
    if (!await lockDirectory(tx, ownerId)) return { status: "not_found" as const };
    const locked = await tx.execute(sql`select id from exams where id = ${examId} and owner_id = ${ownerId} for update`);
    if (locked.length === 0) return { status: "not_found" as const };
    const current = await tx.select({ dni: examStudents.dni }).from(examStudents).where(eq(examStudents.examId, examId));
    const existing = new Set(current.map((student) => student.dni));
    const conflicts = parsed.students.flatMap((student, index) =>
      student.dni && existing.has(student.dni) ? [{ row: parsed.rows[index], message: "El DNI ya existe en el roster de este examen." }] : [],
    );
    if (conflicts.length) return { status: "invalid" as const, problems: conflicts };
    const linked = await tx.select({ studentId: examStudents.studentId, dni: directoryStudents.dni }).from(examStudents)
      .innerJoin(directoryStudents, eq(examStudents.studentId, directoryStudents.id)).where(eq(examStudents.examId, examId));
    const linkConflicts = parsed.students.flatMap((student, index) => student.dni && linked.some((s) => s.dni === student.dni)
      ? [{ row: parsed.rows[index], message: "Esta ficha ya está inscrita en el examen con sus datos históricos." }] : []);
    if (linkConflicts.length) return { status: "invalid" as const, problems: linkConflicts };
    for (const student of parsed.students) {
      let directory = student.dni ? (await tx.select().from(directoryStudents).where(and(eq(directoryStudents.ownerId, ownerId), eq(directoryStudents.dni, student.dni))))[0] : undefined;
      directory ??= (await tx.insert(directoryStudents).values({ ownerId, ...student }).returning())[0];
      await tx.insert(examStudents).values({ examId, studentId: directory.id, ...student });
    }
    return { status: "imported" as const, count: parsed.students.length };
  });
}

export async function updateOwnedStudent(ownerId: string, examId: string, studentId: string, input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { status: "invalid" as const, message: "Los datos del alumno no son válidos." };
  const data = input as Record<string, unknown>;
  if (Object.keys(data).some((key) => !["name", "dni", "originalName", "originalDni"].includes(key)) ||
    typeof data.originalName !== "string" || (data.originalDni !== null && typeof data.originalDni !== "string")) {
    return { status: "invalid" as const, message: "Indica los datos nuevos y originales del alumno, sin campos adicionales." };
  }
  const normalized = normalizeStudent({ name: data.name, dni: data.dni });
  if (!normalized.success) return { status: "invalid" as const, message: normalized.message };
  try {
    return await getDb().transaction(async (tx) => {
      const locked = await tx.execute(sql`select id from exams where id = ${examId} and owner_id = ${ownerId} for update`);
      if (locked.length === 0) return { status: "not_found" as const };
      const [student] = await tx.select().from(examStudents)
        .where(and(eq(examStudents.id, studentId), eq(examStudents.examId, examId))).for("update");
      if (!student) return { status: "student_not_found" as const };
      if (student.name !== data.originalName || student.dni !== data.originalDni) return { status: "conflict" as const };
      const duplicate = normalized.data.dni ? (await tx.select({ id: examStudents.id }).from(examStudents)
        .where(and(eq(examStudents.examId, examId), eq(examStudents.dni, normalized.data.dni))).limit(1))[0] : undefined;
      if (duplicate && duplicate.id !== studentId) return { status: "duplicate" as const };
      const [updated] = await tx.update(examStudents).set(normalized.data)
        .where(and(eq(examStudents.id, studentId), eq(examStudents.examId, examId)))
        .returning({ id: examStudents.id, name: examStudents.name, dni: examStudents.dni });
      return { status: "updated" as const, student: updated };
    });
  } catch (error) {
    // Drizzle wraps the driver's unique-constraint error in cause.
    const cause = error instanceof Error && error.cause ? error.cause : error;
    if (cause && typeof cause === "object" && "code" in cause && cause.code === "23505" &&
      "constraint_name" in cause && cause.constraint_name === "exam_students_exam_dni_unique") return { status: "duplicate" as const };
    throw error;
  }
}

export async function deleteOwnedStudent(ownerId: string, examId: string, studentId: string, confirmResult: boolean) {
  return getDb().transaction(async (tx) => {
    const locked = await tx.execute(sql`select id from exams where id = ${examId} and owner_id = ${ownerId} for update`);
    if (locked.length === 0) return { status: "not_found" as const };
    const [student] = await tx
      .select({ id: examStudents.id })
      .from(examStudents)
      .where(and(eq(examStudents.id, studentId), eq(examStudents.examId, examId)))
      .limit(1);
    if (!student) return { status: "student_not_found" as const };
    const [result] = await tx.select({ studentId: examResults.studentId }).from(examResults).where(eq(examResults.studentId, studentId)).limit(1);
    if (result && !confirmResult) return { status: "result_requires_confirmation" as const };
    await tx.delete(examStudents).where(eq(examStudents.id, studentId));
    return { status: "deleted" as const, hadResult: Boolean(result) };
  });
}

export async function saveOwnedReviewedResult(ownerId: string, examId: string, input: unknown, idempotencyKey: string) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { status: "invalid" as const, message: "La lectura no tiene un formato válido." };
  const data = input as Record<string, unknown>;
  if (Object.keys(data).some((key) => !["studentId", "answers", "replace", "expectedVersion", "expectedStructureVersion"].includes(key)) || !("expectedVersion" in data)) {
    return { status: "invalid" as const, message: "La lectura contiene campos no permitidos." };
  }
  if (typeof data.studentId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.studentId)) {
    return { status: "invalid" as const, message: "Selecciona un alumno válido." };
  }
  const studentId = data.studentId;
  if (data.replace !== undefined && typeof data.replace !== "boolean") return { status: "invalid" as const, message: "La confirmación de reemplazo no es válida." };
  if (data.expectedVersion !== null && (!Number.isInteger(data.expectedVersion) || (data.expectedVersion as number) < 1)) {
    return { status: "invalid" as const, message: "La versión de la entrega no es válida." };
  }
  if (data.expectedStructureVersion !== undefined && (!Number.isSafeInteger(data.expectedStructureVersion) || (data.expectedStructureVersion as number) < 1)) return { status: "invalid" as const, message: "La versión de la configuración no es válida." };

  return getDb().transaction(async (tx) => {
    const locked = await tx.execute(sql`select id from exams where id = ${examId} and owner_id = ${ownerId} for update`);
    if (locked.length === 0) return { status: "not_found" as const };
    const [exam] = await tx.select({ status: exams.status, numQuestions: exams.numQuestions, numOptions: exams.numOptions, structureVersion: exams.structureVersion }).from(exams).where(eq(exams.id, examId)).limit(1);
    const requestHash = hashReviewedRequest({
      studentId,
      answers: data.answers,
      replace: data.replace === true,
      expectedVersion: data.expectedVersion as number | null,
      ...(data.expectedStructureVersion === undefined ? {} : { expectedStructureVersion: data.expectedStructureVersion as number }),
    });

    const [previousRequest] = await tx.select().from(idempotencyKeys).where(and(
      eq(idempotencyKeys.ownerId, ownerId),
      eq(idempotencyKeys.examId, examId),
      eq(idempotencyKeys.key, idempotencyKey),
    )).limit(1);
    if (previousRequest) {
      if (previousRequest.requestHash !== requestHash) return { status: "idempotency_conflict" as const };
      const [currentResult] = await tx.select().from(examResults).where(eq(examResults.studentId, previousRequest.studentId)).limit(1);
      return currentResult
        ? { status: "saved" as const, replayed: true, result: currentResult }
        : { status: "replayed_deleted" as const };
    }
    if (data.expectedStructureVersion !== exam.structureVersion) return { status: "structure_conflict" as const };
    const validatedAnswers = validateReviewedAnswers(data.answers, exam.numQuestions, exam.numOptions);
    if (!validatedAnswers.success) return { status: "invalid" as const, message: validatedAnswers.message };
    if (exam.status !== "key_validated") return { status: "key_not_validated" as const };
    const validation = validatedAnswers;
    const answerKey = await tx.select({ questionNo: answerKeyItems.questionNo, correctOption: answerKeyItems.correctOption }).from(answerKeyItems).where(eq(answerKeyItems.examId, examId));
    if (answerKeyProblems(answerKey.map((item) => ({ q: item.questionNo, answer: item.correctOption })), exam.numQuestions, exam.numOptions).length) {
      return { status: "key_invalid" as const };
    }
    const rule = await getScoringRuleInTransaction(tx, examId);
    const score = calculateScore({ answers: validation.answers, answerKey, numQuestions: exam.numQuestions, numOptions: exam.numOptions, rule });
    if (!score.success) return { status: "invalid" as const, message: score.message };
    const [student] = await tx
      .select({ id: examStudents.id })
      .from(examStudents)
      .where(and(eq(examStudents.id, studentId), eq(examStudents.examId, examId)))
      .limit(1);
    if (!student) return { status: "student_not_found" as const };
    const [existing] = await tx.select({ studentId: examResults.studentId, version: examResults.version }).from(examResults).where(eq(examResults.studentId, student.id)).limit(1);
    if (existing && data.replace !== true) return { status: "exists" as const };
    if (existing && data.expectedVersion !== existing.version) return { status: "version_conflict" as const };
    if (!existing && data.expectedVersion !== null) return { status: "version_conflict" as const };
    const version = existing ? existing.version + 1 : 1;
    if (existing) {
      await tx.update(examResults).set({ ...score.summary, version, savedAt: new Date() }).where(eq(examResults.studentId, student.id));
      await tx.delete(examResultAnswers).where(eq(examResultAnswers.studentId, student.id));
    } else {
      await tx.insert(examResults).values({ studentId: student.id, ...score.summary, version });
    }
    await tx.insert(examResultAnswers).values(validation.answers.map((answer) => ({
      studentId: student.id,
      questionNo: answer.questionNo,
      selectedOption: answer.optionIndex,
    })));
    await tx.insert(idempotencyKeys).values({ ownerId, examId, key: idempotencyKey, requestHash, studentId: student.id });
    return { status: "saved" as const, replayed: false, result: { studentId: student.id, ...score.summary, version, savedAt: new Date() } };
  });
}

export async function deleteOwnedReviewedResult(ownerId: string, examId: string, studentId: string) {
  return getDb().transaction(async (tx) => {
    const locked = await tx.execute(sql`select id from exams where id = ${examId} and owner_id = ${ownerId} for update`);
    if (locked.length === 0) return { status: "not_found" as const };
    const [owned] = await tx
      .select({ studentId: examResults.studentId })
      .from(examResults)
      .innerJoin(examStudents, eq(examStudents.id, examResults.studentId))
      .where(and(eq(examStudents.examId, examId), eq(examStudents.id, studentId)))
      .limit(1);
    if (!owned) return { status: "result_not_found" as const };
    await tx.delete(examResults).where(eq(examResults.studentId, studentId));
    return { status: "deleted" as const };
  });
}
