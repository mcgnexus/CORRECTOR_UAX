import { z } from "zod";
import { auth } from "@/auth";
import { resolveExamAccess } from "@/lib/access";
import { listOwnedAnswerKey } from "@/lib/exam-keys";
import { listOwnedExamRoster } from "@/lib/exam-results";
import { getOwnedScoringRule } from "@/lib/exam-scoring";
import { findOwnedExam } from "@/lib/exams";
import { buildKeyCsv, buildReportCsv, buildResultsCsv } from "@/lib/exports/csv";
import { buildKeyPdf, buildReportPdf, buildResultsPdf } from "@/lib/exports/pdf";
import { exportMimeType, parseExportRequest, buildKeyJson } from "@/lib/exports/request";
import { safeFilename, type ExportBundle } from "@/lib/exports/model";
import { buildKeyXlsx, buildReportXlsx, buildResultsXlsx } from "@/lib/exports/xlsx";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ examId: string }> };
const idSchema = z.string().uuid();

export async function GET(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "No autenticado." }, { status: 401 });
  const { examId } = await context.params;
  const id = idSchema.safeParse(examId);
  if (!id.success) return Response.json({ error: "Examen no encontrado." }, { status: 404 });
  const options = parseExportRequest(new URL(request.url).searchParams);
  if (!options) return Response.json({ error: "Combinación de tipo, formato o separador no admitida." }, { status: 400 });

  const access = await resolveExamAccess(session.user.id, id.data);
  if (!access) return Response.json({ error: "Examen no encontrado." }, { status: 404 });
  const exam = await findOwnedExam(access.ownerId, id.data);
  if (!exam) return Response.json({ error: "Examen no encontrado." }, { status: 404 });
  const [key, roster, scoring] = await Promise.all([
    listOwnedAnswerKey(access.ownerId, exam.id),
    listOwnedExamRoster(access.ownerId, exam.id),
    getOwnedScoringRule(access.ownerId, exam.id),
  ]);
  const students = options.type === "report" && options.studentId
    ? roster.filter((student) => student.id === options.studentId)
    : roster;
  if (options.type === "report" && options.studentId && students.length === 0) {
    return Response.json({ error: "Alumno no encontrado." }, { status: 404 });
  }
  const bundle: ExportBundle = {
    exam: {
      id: exam.id,
      title: exam.title,
      subject: exam.subject,
      numQuestions: exam.numQuestions,
      numOptions: exam.numOptions,
      status: exam.status,
    },
    key: key.map((item) => ({ questionNo: item.questionNo, correctOption: item.correctOption })),
    rule: scoring?.rule,
    students: students.map((student) => ({
      id: student.id,
      name: student.name,
      dni: student.dni,
      savedAt: student.savedAt,
      answers: student.answers,
      correct: student.correct,
      wrong: student.wrong,
      blank: student.blank,
      rawScore: student.rawScore,
      score: student.score,
    })),
  };

  let output: string | Uint8Array;
  if (options.type === "key" && options.format === "csv") output = buildKeyCsv(bundle, options.delimiter);
  else if (options.type === "key" && options.format === "xlsx") output = await buildKeyXlsx(bundle);
  else if (options.type === "key" && options.format === "pdf") output = await buildKeyPdf(bundle);
  else if (options.type === "key" && options.format === "json") output = buildKeyJson(bundle);
  else if (options.type === "results" && options.format === "csv") output = buildResultsCsv(bundle, options.delimiter);
  else if (options.type === "results" && options.format === "xlsx") output = await buildResultsXlsx(bundle);
  else if (options.type === "results" && options.format === "pdf") output = await buildResultsPdf(bundle);
  else if (options.type === "report" && options.format === "csv") output = buildReportCsv(bundle, options.delimiter);
  else if (options.type === "report" && options.format === "xlsx") output = await buildReportXlsx(bundle);
  else if (options.type === "report" && options.format === "pdf") output = await buildReportPdf(bundle);
  else return Response.json({ error: "Combinación de exportación no admitida." }, { status: 400 });

  const reportStudent = options.type === "report" && options.studentId
    ? students[0]
    : undefined;
  const suffix = reportStudent ? `-${safeFilename(reportStudent.name)}` : "";
  const filename = `examen-${safeFilename(exam.title)}-${exam.id.slice(0, 8)}-${options.type}${suffix}.${options.format}`;
  let body: BodyInit;
  if (typeof output === "string") body = output;
  else {
    const copy = new ArrayBuffer(output.byteLength);
    new Uint8Array(copy).set(output);
    body = copy;
  }
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": exportMimeType(options.format),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
