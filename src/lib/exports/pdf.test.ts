import assert from "node:assert/strict";
import test from "node:test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { buildKeyPdf, buildReportPdf, buildResultsPdf } from "@/lib/exports/pdf";
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
    rule: { pointsCorrect: "1.0000", pointsWrong: "-0.3333", pointsBlank: "0.0000", maxScore: "10.0000" },
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

test("100 preguntas se conservan completas en la ficha", async () => {
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
  const text = decodedText(Buffer.from(pdf, "latin1"));
  for (let question = 1; question <= 100; question += 1) assert.ok(text.includes(`P${question}:A`));
});

test("ambos PDF relacionan cada fallo con su marcada y correcta sin depender del color", async () => {
  const data = bundle();
  data.exam.status = "key_validated";
  data.key = [{ questionNo: 2, correctOption: "D" }, { questionNo: 1, correctOption: "C" }];
  data.students = [{ ...data.students[0], answers: [{ questionNo: 2, optionIndex: 0 }, { questionNo: 1, optionIndex: 1 }], correct: 0, wrong: 2, blank: 0, rawScore: "-0.6666", score: "0.00" }];
  const results = decodedText(Buffer.from(await buildResultsPdf(data)));
  assert.match(results, /P1:MARCÓB·CORRECTA:C/);
  assert.match(results, /P2:MARCÓA·CORRECTA:D/);
  const report = decodedText(Buffer.from(await buildReportPdf(data)));
  assert.match(report, /1BCFALLO·MARCÓB·CORRECTA:C-0\.3333/);
  assert.match(report, /2ADFALLO·MARCÓA·CORRECTA:D-0\.3333/);
});

test("ambos PDF conservan acierto y blanco vinculados a su pregunta", async () => {
  const data = bundle();
  data.exam.status = "key_validated";
  data.key = [{ questionNo: 2, correctOption: "C" }, { questionNo: 1, correctOption: "A" }];
  data.students = [{ ...data.students[0], correct: 1, wrong: 0, blank: 1, rawScore: "1.0000", score: "5.00" }];
  const results = decodedText(Buffer.from(await buildResultsPdf(data)));
  assert.match(results, /P1:AP2:ENBLANCO/);
  assert.doesNotMatch(results, /P[12]:MARCÓ/);
  const report = decodedText(Buffer.from(await buildReportPdf(data)));
  assert.match(report, /1AAACIERTO1\.0000/);
  assert.match(report, /2ENBLANCOCBLANCO0\.0000/);
});

test("ambos PDF paginan 100 fallos y nombres largos sin perder respuestas ni calculo", async () => {
  const data = bundle();
  data.exam.numQuestions = 100;
  data.exam.status = "key_validated";
  data.key = Array.from({ length: 100 }, (_, index) => ({ questionNo: index + 1, correctOption: index % 2 ? "D" : "C" }));
  data.students = [{ ...data.students[0], name: "Nombre Apellido ".repeat(30) + "FINNOMBRE", answers: Array.from({ length: 100 }, (_, index) => ({ questionNo: index + 1, optionIndex: index % 2 ? 0 : 1 })), correct: 0, wrong: 100, blank: 0, rawScore: "-33.3300", score: "0.00" }];
  for (const build of [buildResultsPdf, buildReportPdf]) {
    const pdf = Buffer.from(await build(data));
    const text = decodedText(pdf);
    assert.ok(text.includes("FINNOMBRE"));
    for (let question = 1; question <= 100; question += 1) {
      const given = question % 2 ? "B" : "A";
      const correct = question % 2 ? "C" : "D";
      assert.ok(text.includes(build === buildResultsPdf ? `P${question}:MARCÓ${given}·CORRECTA:${correct}` : `${question}${given}${correct}FALLO·MARCÓ${given}·CORRECTA:${correct}-0.3333`), `Pregunta ${question}`);
    }
    assert.ok(Number(pdf.toString("latin1").match(/\/Count (\d+)/)?.[1]) > 2);
    const loading = getDocument({ data: new Uint8Array(pdf), useSystemFonts: true });
    const parsed = await loading.promise;
    try {
      for (let pageNo = 1; pageNo <= parsed.numPages; pageNo += 1) {
        const page = await parsed.getPage(pageNo);
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        for (const item of content.items) {
          if (!("str" in item) || !item.str.trim()) continue;
          const x = item.transform[4];
          const y = viewport.height - item.transform[5];
          assert.ok(x >= 43 && x + item.width <= viewport.width - 40, `Texto fuera del ancho en pagina ${pageNo}: ${item.str}`);
          assert.ok(y >= 40 && y <= viewport.height - 40, `Texto fuera del alto en pagina ${pageNo}: ${item.str}`);
          if (!item.str.startsWith("Corrector UAX")) assert.ok(y < viewport.height - 70, `Texto invade pie: ${item.str}`);
        }
      }
    } finally {
      await loading.destroy();
    }
    if (build === buildReportPdf) {
      assert.ok(text.includes("SUMABRUTA-33.3300"));
      assert.ok(text.includes("100.0000"));
      assert.ok(text.includes("0.00"));
    }
  }
});

test("clave pendiente o incompleta y calculo pendiente no imprimen fallos definitivos", async () => {
  for (const state of ["key_pending", "incomplete", "calculation"] as const) {
    const data = bundle();
    data.students = [data.students[0]];
    data.exam.status = state === "key_pending" ? "key_pending" : "key_validated";
    if (state !== "incomplete") data.key = [{ questionNo: 1, correctOption: "C" }, { questionNo: 2, correctOption: "D" }];
    for (const build of [buildResultsPdf, buildReportPdf]) {
      const text = decodedText(Buffer.from(await build(data)));
      assert.ok(text.includes(state === "calculation" ? "PENDIENTEDECÁLCULO" : "PENDIENTEDECLAVE"));
      assert.doesNotMatch(text, /MARCÓA·CORRECTA:C|FALLO·MARCÓ/);
    }
  }
});
