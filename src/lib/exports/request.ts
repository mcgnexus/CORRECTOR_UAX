import type { CsvDelimiter } from "./csv";
import { isKeyValidated } from "./model";

export type ExportRequest =
  | { type: "key"; format: "csv" | "xlsx" | "pdf" | "json"; delimiter: CsvDelimiter }
  | { type: "results"; format: "csv" | "xlsx" | "pdf"; delimiter: CsvDelimiter }
  | { type: "report"; format: "csv" | "xlsx" | "pdf"; delimiter: CsvDelimiter; studentId?: string };

export function parseExportRequest(params: URLSearchParams): ExportRequest | undefined {
  const type = params.get("type");
  const format = params.get("format");
  const rawDelimiter = params.get("delimiter");
  if (type !== "key" && type !== "results" && type !== "report") return undefined;
  if (rawDelimiter !== null && rawDelimiter !== "," && rawDelimiter !== ";") return undefined;
  const delimiter: CsvDelimiter = rawDelimiter === "," ? "," : ";";
  if (type === "key" && (format === "csv" || format === "xlsx" || format === "pdf" || format === "json")) {
    return { type, format, delimiter };
  }
  if (type === "results" && (format === "csv" || format === "xlsx" || format === "pdf")) {
    return { type, format, delimiter };
  }
  if (type === "report" && (format === "csv" || format === "xlsx" || format === "pdf")) {
    const studentId = params.get("studentId");
    if (studentId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(studentId)) return undefined;
    return { type, format, delimiter, ...(studentId ? { studentId } : {}) };
  }
  return undefined;
}

export function buildKeyJson(bundle: {
  exam: { id: string; title: string; subject: string | null; numQuestions: number; numOptions: number; status: string };
  key: Array<{ questionNo: number; correctOption: string }>;
}) {
  const answers = new Map(bundle.key.map((answer) => [answer.questionNo, answer.correctOption]));
  const keyState = isKeyValidated({
    exam: {
      id: bundle.exam.id,
      title: bundle.exam.title,
      subject: bundle.exam.subject,
      numQuestions: bundle.exam.numQuestions,
      numOptions: bundle.exam.numOptions,
      status: bundle.exam.status as "draft" | "key_pending" | "key_validated",
    },
    key: bundle.key,
    students: [],
  }) ? "key_validated" : bundle.exam.status === "draft" ? "draft" : "key_pending";
  return JSON.stringify({
    schemaVersion: 1,
    exam: {
      title: bundle.exam.title,
      subject: bundle.exam.subject,
      numQuestions: bundle.exam.numQuestions,
      numOptions: bundle.exam.numOptions,
      status: keyState,
    },
    answers: Array.from({ length: bundle.exam.numQuestions }, (_, index) => ({
      questionNo: index + 1,
      correctOption: answers.get(index + 1) ?? null,
    })),
  }, null, 2);
}

export function exportMimeType(format: ExportRequest["format"]) {
  if (format === "csv") return "text/csv; charset=utf-8";
  if (format === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (format === "pdf") return "application/pdf";
  return "application/json; charset=utf-8";
}
