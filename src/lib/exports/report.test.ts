import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import test from "node:test";
import { buildReportCsv } from "@/lib/exports/csv";
import { buildReportPdf } from "@/lib/exports/pdf";
import { reportCalculationRows, reportStudentRows, type ExportBundle } from "@/lib/exports/model";
import { buildReportXlsx } from "@/lib/exports/xlsx";

const rule = { pointsCorrect: "1.0000", pointsWrong: "-0.3333", pointsBlank: "0.0000", maxScore: "10.0000" };

function bundle(status: ExportBundle["exam"]["status"] = "key_validated"): ExportBundle {
  return {
    exam: { id: "exam-id", title: "Prueba final", subject: "Matemáticas", numQuestions: 2, numOptions: 4, status },
    key: [{ questionNo: 1, correctOption: "A" }, { questionNo: 2, correctOption: "C" }],
    rule,
    students: [
      { id: "ana", name: "Ana", dni: "X123", savedAt: new Date(), answers: [{ questionNo: 1, optionIndex: 0 }, { questionNo: 2, optionIndex: null }], correct: 1, wrong: 0, blank: 1, rawScore: "1.0000", score: "5.00" },
      { id: "luis", name: "Luis", dni: "Y456", savedAt: new Date(), answers: [{ questionNo: 1, optionIndex: 1 }, { questionNo: 2, optionIndex: 2 }], correct: 1, wrong: 1, blank: 0, rawScore: "0.6667", score: "3.33" },
      { id: "pending", name: "Sin entrega", dni: "Z789", savedAt: null, answers: null, correct: null, wrong: null, blank: null, rawScore: null, score: null },
    ],
  };
}

function decodedText(pdf: Buffer) {
  return [...pdf.toString("latin1").matchAll(/<([0-9a-f]{2,})>/gi)]
    .map((match) => Buffer.from(match[1], "hex").toString("latin1"))
    .join("")
    .replace(/\s/g, "")
    .toUpperCase();
}

function asExcelBuffer(bytes: Uint8Array) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer as unknown as Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0];
}

test("el informe muestra aciertos, fallos con la respuesta correcta y blancos", () => {
  const rows = reportStudentRows(bundle());
  const ana = rows.find((row) => row.student.id === "ana");
  const luis = rows.find((row) => row.student.id === "luis");
  assert.ok(ana && luis);
  assert.deepEqual(ana.questions[0], { questionNo: 1, given: "A", correct: "A", outcome: "Acierto", points: "1.0000" });
  assert.deepEqual(ana.questions[1], { questionNo: 2, given: "En blanco", correct: "C", outcome: "Blanco", points: "0.0000" });
  assert.deepEqual(luis.questions[0], { questionNo: 1, given: "B", correct: "A", outcome: "Fallo", points: "-0.3333" });
  assert.equal(luis.questions[1].outcome, "Acierto");
});

test("el cálculo del informe coincide con los pasos esperados", () => {
  const luis = reportStudentRows(bundle()).find((row) => row.student.id === "luis");
  assert.ok(luis?.breakdown);
  assert.equal(luis.breakdown.correctSubtotal, "1.0000");
  assert.equal(luis.breakdown.wrongSubtotal, "-0.3333");
  assert.equal(luis.breakdown.blankSubtotal, "0.0000");
  assert.equal(luis.breakdown.rawScore, "0.6667");
  assert.equal(luis.breakdown.maxRaw, "2.0000");
  assert.equal(luis.breakdown.score, "3.33");
  assert.deepEqual(reportCalculationRows(luis), [
    ["Aciertos: 1 × 1.0000", "1.0000"],
    ["Fallos: 1 × -0.3333", "-0.3333"],
    ["Blancos: 0 × 0.0000", "0.0000"],
    ["Suma bruta", "0.6667"],
    ["Bruto acotado (0 … 2.0000)", "0.6667"],
    ["Nota = bruto acotado / 2.0000 × 10.0000", "3.33"],
  ]);
});

test("CSV del informe incluye respuesta correcta, resultado y desglose", () => {
  const csv = buildReportCsv(bundle(), ";");
  assert.ok(csv.startsWith("\uFEFFNombre;DNI;Pregunta;Respuesta alumno;Respuesta correcta;Resultado;Puntos;Aciertos;Fallos;Blancos;Bruto;Nota;Estado"));
  assert.match(csv, /Luis;Y456;1;B;A;Fallo;-0\.3333;1;1;0;0\.6667;3\.33;Corregido/);
  assert.match(csv, /Ana;X123;2;En blanco;C;Blanco;0\.0000;1;0;1;1\.0000;5\.00;Corregido/);
  assert.match(csv, /Sin entrega;Z789;1;Sin entrega;A;Sin entrega;.*;Pendiente/);
});

test("PDF del informe contiene detalle y cálculo por alumno", async () => {
  const pdf = Buffer.from(await buildReportPdf(bundle())).toString("latin1");
  assert.ok(pdf.startsWith("%PDF-"));
  const text = decodedText(Buffer.from(pdf, "latin1"));
  assert.match(text, /INFORMEDECORRECCI/);
  assert.match(text, /DETALLEPORPREGUNTA/);
  assert.match(text, /CÁLCULODELANOTA/);
  assert.match(text, /SUMABRUTA/);
  assert.match(text, /LUIS/);
  assert.match(pdf, /\/Count 4/);
});

test("XLSX del informe separa detalle y cálculo", async () => {
  const bytes = await buildReportXlsx(bundle());
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(asExcelBuffer(bytes));
  const detail = workbook.getWorksheet("Informe");
  const calculation = workbook.getWorksheet("Cálculo");
  assert.ok(detail && calculation);
  assert.equal(detail.getCell("A1").value, "Nombre");
  const rows: unknown[][] = [];
  detail.eachRow((row) => rows.push(row.values as unknown[]));
  const luisRow = rows.find((row) => row[1] === "Luis" && row[3] === 1);
  assert.ok(luisRow);
  assert.equal(luisRow[4], "B");
  assert.equal(luisRow[5], "A");
  assert.equal(luisRow[6], "Fallo");
  assert.equal(luisRow[7], -0.3333);
  const calculationRows: unknown[][] = [];
  calculation.eachRow((row) => calculationRows.push(row.values as unknown[]));
  const luisCalculation = calculationRows.find((row) => row[1] === "Luis");
  assert.ok(luisCalculation);
  assert.equal(Number(luisCalculation[16]), 3.33);
});

test("con la clave pendiente el informe no inventa respuestas correctas", () => {
  const rows = reportStudentRows(bundle("key_pending"));
  assert.equal(rows[0].questions[0].outcome, "Pendiente de clave");
  assert.equal(rows[0].questions[0].correct, null);
  assert.equal(rows[0].breakdown, null);
});
