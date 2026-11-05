import assert from "node:assert/strict";
import test from "node:test";
import { buildKeyJson, parseExportRequest } from "@/lib/exports/request";

test("acepta solo combinaciones de exportación permitidas", () => {
  for (const format of ["csv", "xlsx", "pdf", "json"]) {
    assert.equal(parseExportRequest(new URLSearchParams({ type: "key", format }))?.format, format);
  }
  for (const format of ["csv", "xlsx", "pdf"]) {
    assert.equal(parseExportRequest(new URLSearchParams({ type: "results", format }))?.format, format);
  }
  assert.equal(parseExportRequest(new URLSearchParams({ type: "results", format: "json" })), undefined);
  assert.equal(parseExportRequest(new URLSearchParams({ type: "key", format: "xml" })), undefined);
  assert.equal(parseExportRequest(new URLSearchParams({ type: "other", format: "csv" })), undefined);
});

test("CSV admite coma o punto y coma, con punto y coma por defecto", () => {
  assert.equal(parseExportRequest(new URLSearchParams({ type: "results", format: "csv" }))?.delimiter, ";");
  assert.equal(parseExportRequest(new URLSearchParams({ type: "key", format: "csv", delimiter: "," }))?.delimiter, ",");
  assert.equal(parseExportRequest(new URLSearchParams({ type: "key", format: "csv", delimiter: "|" })), undefined);
});

test("JSON de clave incluye estado y preguntas vacías sin datos personales", () => {
  const data = JSON.parse(buildKeyJson({
    exam: { id: "internal-id", title: "Examen", subject: null, numQuestions: 2, numOptions: 4, status: "key_pending" },
    key: [{ questionNo: 2, correctOption: "C" }],
  }));
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.exam.status, "key_pending");
  assert.deepEqual(data.answers, [{ questionNo: 1, correctOption: null }, { questionNo: 2, correctOption: "C" }]);
  assert.equal(JSON.stringify(data).includes("DNI"), false);
});
