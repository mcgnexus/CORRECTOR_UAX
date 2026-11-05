import assert from "node:assert/strict";
import test from "node:test";
import { buildKeyCsv, buildResultsCsv } from "@/lib/exports/csv";
import { resultExportRows, resultExportSummary, safeFilename, type ExportBundle } from "@/lib/exports/model";

function bundle(status: ExportBundle["exam"]["status"] = "key_validated"): ExportBundle {
  return {
    exam: { id: "exam-id", title: "Evaluación", subject: "Base de datos", numQuestions: 2, numOptions: 4, status },
    key: [{ questionNo: 1, correctOption: "A" }, { questionNo: 2, correctOption: "C" }],
    students: [
      { id: "one", name: "=HYPERLINK(\"https://x\")", dni: "X123", savedAt: new Date(), answers: [{ questionNo: 1, optionIndex: 0 }, { questionNo: 2, optionIndex: null }], correct: 1, wrong: 0, blank: 1, rawScore: "1.0000", score: "5.00" },
      { id: "two", name: "Pérez, Ana\nLópez", dni: "Y456", savedAt: null, answers: null, correct: null, wrong: null, blank: null, rawScore: null, score: null },
    ],
  };
}

test("CSV lleva BOM, escapa campos y neutraliza formulas en textos libres", () => {
  const csv = buildResultsCsv(bundle(), ";");
  assert.ok(csv.startsWith("\uFEFFNombre;DNI;P1;P2;Aciertos"));
  assert.match(csv, /'=HYPERLINK\(""https:\/\/x""\)/);
  assert.match(csv, /"Pérez, Ana\nLópez"/);
  assert.match(csv, /En blanco/);
  assert.match(csv, /Pendiente$/);
});

test("CSV acepta coma y clave expone estado y todos los números de pregunta", () => {
  assert.ok(buildResultsCsv(bundle(), ",").startsWith("\uFEFFNombre,DNI,P1,P2"));
  const csv = buildKeyCsv({ ...bundle("key_pending"), key: [{ questionNo: 2, correctOption: "C" }] }, ";");
  assert.match(csv, /Pregunta;Respuesta correcta;Estado de clave/);
  assert.match(csv, /1;;Pendiente de validar/);
  assert.match(csv, /2;C;Pendiente de validar/);
});

test("estados pendientes y media ignoran notas no calculadas", () => {
  const data = bundle("key_pending");
  const rows = resultExportRows(data);
  assert.equal(rows[0].state, "Pendiente de clave");
  assert.deepEqual(rows[0].answers, ["A", "En blanco"]);
  assert.equal(rows[0].score, null);
  assert.equal(rows[1].state, "Pendiente");
  assert.deepEqual(rows[1].answers, ["", ""]);
  assert.deepEqual(resultExportSummary(rows), { total: 2, corrected: 0, pending: 1, keyPending: 1, calculationPending: 0, mean: null });
});

test("sanea filename sin incluir rutas", () => {
  assert.equal(safeFilename("Práctica / tema: 1"), "practica-tema-1");
  assert.equal(safeFilename("../../"), "examen");
});
