import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import test from "node:test";
import { buildKeyXlsx, buildResultsXlsx } from "@/lib/exports/xlsx";
import type { ExportBundle } from "@/lib/exports/model";

function bundle(): ExportBundle {
  return {
    exam: { id: "exam-id", title: "Prueba", subject: null, numQuestions: 2, numOptions: 4, status: "key_validated" },
    key: [{ questionNo: 1, correctOption: "A" }, { questionNo: 2, correctOption: "C" }],
    students: [
      { id: "correct", name: "=1+1", dni: "X123", savedAt: new Date(), answers: [{ questionNo: 1, optionIndex: 0 }, { questionNo: 2, optionIndex: null }], correct: 1, wrong: 0, blank: 1, rawScore: "1.0000", score: "5.00" },
      { id: "wrong", name: "Ana", dni: "Y456", savedAt: new Date(), answers: [{ questionNo: 1, optionIndex: 1 }, { questionNo: 2, optionIndex: 2 }], correct: 1, wrong: 1, blank: 0, rawScore: "2.0000", score: "5.00" },
      { id: "pending", name: "Luis", dni: "Z789", savedAt: null, answers: null, correct: null, wrong: null, blank: null, rawScore: null, score: null },
    ],
  };
}

function asExcelBuffer(bytes: Uint8Array) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer as unknown as Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0];
}

test("XLSX de resultados conserva tipos, estados y estilos de clave", async () => {
  const bytes = await buildResultsXlsx(bundle());
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(asExcelBuffer(bytes));
  const sheet = workbook.getWorksheet("Resultados");
  assert.ok(sheet);
  assert.equal(sheet.getCell("A1").value, "Nombre");
  assert.equal(sheet.getCell("C2").value, "A");
  const correctFill = sheet.getCell("C2").fill;
  const wrongFill = sheet.getCell("C3").fill;
  assert.ok(correctFill.type === "pattern");
  assert.ok(wrongFill.type === "pattern");
  assert.ok(correctFill.fgColor);
  assert.ok(wrongFill.fgColor);
  assert.equal(correctFill.fgColor!.argb, "FFC6EFCE");
  assert.equal(wrongFill.fgColor!.argb, "FFFFC7CE");
  assert.equal(sheet.getCell("E2").value, 1);
  assert.equal(sheet.getCell("J4").value, "Pendiente");
  assert.equal(sheet.getCell("C4").value, "");
  assert.equal(sheet.getCell("A2").value, "=1+1");
  assert.equal(sheet.getCell("A2").formula, undefined);
});

test("XLSX de clave incluye huecos y estado de borrador", async () => {
  const draft = bundle();
  draft.exam.status = "key_pending";
  draft.key = [{ questionNo: 2, correctOption: "C" }];
  const bytes = await buildKeyXlsx(draft);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(asExcelBuffer(bytes));
  const sheet = workbook.getWorksheet("Clave");
  assert.ok(sheet);
  assert.equal(sheet.getCell("A2").value, 1);
  assert.equal(sheet.getCell("B2").value, null);
  assert.equal(sheet.getCell("C2").value, "Pendiente de validar");
  assert.equal(sheet.getCell("B3").value, "C");
});
