import assert from "node:assert/strict";
import test from "node:test";
import { buildKeyPdf, buildResultsPdf } from "@/lib/exports/pdf";
import type { ExportBundle } from "@/lib/exports/model";

function decodedText(pdf: Buffer) {
  return [...pdf.toString("latin1").matchAll(/<([0-9a-f]{2,})>/gi)]
    .map((match) => Buffer.from(match[1], "hex").toString("latin1"))
    .join("")
    .replace(/\s/g, "")
    .toUpperCase();
}

function bundle(): ExportBundle {
  return {
    exam: { id: "exam-id", title: "Prueba final", subject: "Historia", numQuestions: 2, numOptions: 4, status: "key_pending" },
    key: [{ questionNo: 2, correctOption: "B" }],
    students: [
      { id: "saved", name: "Ana", dni: "X123", savedAt: new Date(), answers: [{ questionNo: 1, optionIndex: 0 }, { questionNo: 2, optionIndex: null }], correct: null, wrong: null, blank: null, rawScore: null, score: null },
      { id: "pending", name: "Luis", dni: "Y456", savedAt: null, answers: null, correct: null, wrong: null, blank: null, rawScore: null, score: null },
    ],
  };
}

test("PDF de clave borrador incluye advertencia visible y todas las preguntas", async () => {
  const pdf = Buffer.from(await buildKeyPdf(bundle())).toString("latin1");
  assert.ok(pdf.startsWith("%PDF-"));
  assert.match(decodedText(Buffer.from(pdf, "latin1")), /BORRADOR\/NOVALIDADA/);
  assert.match(decodedText(Buffer.from(pdf, "latin1")), /PREGUNTA1/);
  assert.match(decodedText(Buffer.from(pdf, "latin1")), /PREGUNTA2/);
  assert.match(pdf, /\/Count 1/);
});

test("PDF de resultados tiene resumen y una ficha por alumno incluido pendiente", async () => {
  const pdf = Buffer.from(await buildResultsPdf(bundle())).toString("latin1");
  assert.ok(pdf.startsWith("%PDF-"));
  assert.match(decodedText(Buffer.from(pdf, "latin1")), /RESUMEN/);
  assert.match(decodedText(Buffer.from(pdf, "latin1")), /ANA/);
  assert.match(decodedText(Buffer.from(pdf, "latin1")), /LUIS/);
  assert.match(decodedText(Buffer.from(pdf, "latin1")), /PENDIENTEDECLAVE/);
  assert.match(pdf, /\/Count 3/);
});

test("un alumno con 100 preguntas cabe en una sola ficha", async () => {
  const large = bundle();
  large.exam.numQuestions = 100;
  large.exam.status = "key_validated";
  large.key = Array.from({ length: 100 }, (_, index) => ({ questionNo: index + 1, correctOption: "A" }));
  large.students = [{
    id: "large",
    name: "Alumna",
    dni: "X123",
    savedAt: new Date(),
    answers: Array.from({ length: 100 }, (_, index) => ({ questionNo: index + 1, optionIndex: 0 })),
    correct: 100,
    wrong: 0,
    blank: 0,
    rawScore: "100.0000",
    score: "10.00",
  }];
  const pdf = Buffer.from(await buildResultsPdf(large)).toString("latin1");
  assert.match(pdf, /\/Count 2/);
});
