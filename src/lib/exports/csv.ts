import { isKeyValidated, keyExportRows, resultExportRows, type ExportBundle } from "./model";

export type CsvDelimiter = "," | ";";

function escapeCell(value: string | number | null, delimiter: CsvDelimiter, userText = false) {
  if (value === null) return "";
  let text = String(value);
  if (userText && /^[\s\u0000-\u001f]*[=+\-@]/u.test(text)) text = `'${text}`;
  if (text.includes(delimiter) || /["\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function buildKeyCsv(bundle: ExportBundle, delimiter: CsvDelimiter) {
  const status = isKeyValidated(bundle) ? "Validada" : bundle.exam.status === "draft" ? "Borrador" : "Pendiente de validar";
  const lines = [
    ["Pregunta", "Respuesta correcta", "Estado de clave"],
    ...keyExportRows(bundle).map((row) => [row.questionNo, row.correctOption, status]),
  ];
  return `\uFEFF${lines.map((line) => line.map((value) => escapeCell(value, delimiter)).join(delimiter)).join("\r\n")}`;
}

export function buildResultsCsv(bundle: ExportBundle, delimiter: CsvDelimiter) {
  const headers = ["Nombre", "DNI", ...Array.from({ length: bundle.exam.numQuestions }, (_, index) => `P${index + 1}`), "Aciertos", "Fallos", "Blancos", "Bruto", "Nota", "Estado"];
  const rows = resultExportRows(bundle).map((row) => [
    escapeCell(row.student.name, delimiter, true),
    escapeCell(row.student.dni, delimiter, true),
    ...row.answers.map((answer) => escapeCell(answer, delimiter)),
    escapeCell(row.correct, delimiter),
    escapeCell(row.wrong, delimiter),
    escapeCell(row.blank, delimiter),
    escapeCell(row.rawScore, delimiter),
    escapeCell(row.score, delimiter),
    escapeCell(row.state, delimiter),
  ].join(delimiter));
  return `\uFEFF${[headers.map((header) => escapeCell(header, delimiter)).join(delimiter), ...rows].join("\r\n")}`;
}
