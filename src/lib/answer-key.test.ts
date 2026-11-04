import assert from "node:assert/strict";
import test from "node:test";
import {
  answerKeyProblems,
  parseAnswerKeyPayload,
  parseProviderAnswerKey,
} from "@/lib/answer-key";

test("acepta clave completa y la ordena por número de pregunta", () => {
  const result = parseProviderAnswerKey(
    JSON.stringify([
      { q: 2, answer: "C", confidence: 0.8 },
      { q: 1, answer: "A", confidence: 0.9 },
    ]),
    2,
    4,
  );
  assert.equal(result.success, true);
  if (result.success) assert.deepEqual(result.data.map((item) => item.q), [1, 2]);
});

test("rechaza JSON vacío, preguntas repetidas, opciones inválidas y claves incompletas", () => {
  assert.equal(parseProviderAnswerKey("   ", 1, 4).success, false);
  assert.equal(parseProviderAnswerKey("not json", 1, 4).success, false);
  assert.equal(
    parseProviderAnswerKey(JSON.stringify([{ q: 1, answer: "E", confidence: 0.5 }]), 1, 4).success,
    false,
  );
  assert.equal(
    parseProviderAnswerKey(
      JSON.stringify([
        { q: 1, answer: "A", confidence: 0.5 },
        { q: 1, answer: "B", confidence: 0.6 },
      ]),
      2,
      4,
    ).success,
    false,
  );
});

test("permite guardar un borrador parcial pero impide validarlo como completo", () => {
  const payload = { answers: [{ q: 1, answer: "A", confidence: null, editedByTeacher: true }] };
  assert.equal(parseAnswerKeyPayload(payload, 2, 4).success, true);
  assert.deepEqual(answerKeyProblems(payload.answers, 2, 4), ["Debe haber exactamente una respuesta por pregunta."]);
});

test("valida rango, confianza y unicidad en el borrador", () => {
  assert.equal(
    parseAnswerKeyPayload({ answers: [{ q: 3, answer: "A" }] }, 2, 4).success,
    false,
  );
  assert.equal(
    parseAnswerKeyPayload(
      { answers: [{ q: 1, answer: "E", confidence: 0.5, editedByTeacher: false }] },
      1,
      4,
    ).success,
    false,
  );
});
