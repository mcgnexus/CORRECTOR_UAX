import assert from "node:assert/strict";
import test from "node:test";
import { calculateScore, DEFAULT_SCORING_RULE, scoreBreakdown, validateScoringRule } from "@/lib/scoring";

const answerKey = [
  { questionNo: 1, correctOption: "A" },
  { questionNo: 2, correctOption: "C" },
  { questionNo: 3, correctOption: "B" },
  { questionNo: 4, correctOption: "D" },
];

test("calcula aciertos, fallos, blancos y escala al máximo", () => {
  const result = calculateScore({
    answers: [
      { questionNo: 1, optionIndex: 0 },
      { questionNo: 2, optionIndex: 0 },
      { questionNo: 3, optionIndex: null },
      { questionNo: 4, optionIndex: 3 },
    ],
    answerKey,
    numQuestions: 4,
    numOptions: 4,
    rule: DEFAULT_SCORING_RULE,
  });
  assert.deepEqual(result, { success: true, summary: { correct: 2, wrong: 1, blank: 1, rawScore: "2.0000", score: "5.00" } });
});

test("aplica penalización negativa y limita la nota mínima a cero", () => {
  const result = calculateScore({
    answers: [2, 0, 3, 1].map((optionIndex, index) => ({ questionNo: index + 1, optionIndex })),
    answerKey,
    numQuestions: 4,
    numOptions: 4,
    rule: { pointsCorrect: 1, pointsWrong: -0.5, pointsBlank: -0.25, maxScore: 10 },
  });
  assert.deepEqual(result, { success: true, summary: { correct: 0, wrong: 4, blank: 0, rawScore: "-2.0000", score: "0.00" } });
});

test("penaliza fallos y blancos según la regla y escala con puntos por acierto", () => {
  const result = calculateScore({
    answers: [
      { questionNo: 1, optionIndex: 0 },
      { questionNo: 2, optionIndex: 2 },
      { questionNo: 3, optionIndex: 3 },
      { questionNo: 4, optionIndex: null },
    ],
    answerKey,
    numQuestions: 4,
    numOptions: 4,
    rule: { pointsCorrect: 0.5, pointsWrong: -0.25, pointsBlank: -0.5, maxScore: 20 },
  });
  assert.deepEqual(result, { success: true, summary: { correct: 2, wrong: 1, blank: 1, rawScore: "0.2500", score: "2.50" } });
});

test("limita puntuación al máximo normalizado y redondea empates half-up", () => {
  const perfect = calculateScore({
    answers: [1, 2, 3, 4].map((questionNo) => ({ questionNo, optionIndex: [0, 2, 1, 3][questionNo - 1] })),
    answerKey,
    numQuestions: 4,
    numOptions: 4,
    rule: { pointsCorrect: 1, pointsWrong: -2, pointsBlank: -3, maxScore: 12.345 },
  });
  assert.deepEqual(perfect, { success: true, summary: { correct: 4, wrong: 0, blank: 0, rawScore: "4.0000", score: "12.35" } });

  const tie = calculateScore({
    answers: [{ questionNo: 1, optionIndex: 0 }, { questionNo: 2, optionIndex: 2 }, { questionNo: 3, optionIndex: 1 }, { questionNo: 4, optionIndex: null }],
    answerKey,
    numQuestions: 4,
    numOptions: 4,
    rule: { pointsCorrect: 1, pointsWrong: 0, pointsBlank: 0, maxScore: 10.01 },
  });
  assert.deepEqual(tie, { success: true, summary: { correct: 3, wrong: 0, blank: 1, rawScore: "3.0000", score: "7.51" } });
});

test("rechaza reglas con signos, precisión o campos incorrectos", () => {
  assert.equal(validateScoringRule({ pointsCorrect: 0, pointsWrong: 0, pointsBlank: 0, maxScore: 10 }).success, false);
  assert.equal(validateScoringRule({ pointsCorrect: 1, pointsWrong: 0.1, pointsBlank: 0, maxScore: 10 }).success, false);
  assert.equal(validateScoringRule({ pointsCorrect: 1, pointsWrong: 0, pointsBlank: 0, maxScore: "NaN" }).success, false);
  assert.equal(validateScoringRule({ pointsCorrect: 1.00001, pointsWrong: 0, pointsBlank: 0, maxScore: 10 }).success, false);
  assert.equal(validateScoringRule({ pointsCorrect: 1, pointsWrong: 0, pointsBlank: 0, maxScore: 10, score: 100 }).success, false);
});

test("rechaza claves o respuestas incompletas y opciones fuera del examen", () => {
  const answers = [1, 2, 3, 4].map((questionNo) => ({ questionNo, optionIndex: 0 }));
  assert.equal(calculateScore({ answers: answers.slice(1), answerKey, numQuestions: 4, numOptions: 4, rule: DEFAULT_SCORING_RULE }).success, false);
  assert.equal(calculateScore({ answers: [{ ...answers[0], optionIndex: 4 }, ...answers.slice(1)], answerKey, numQuestions: 4, numOptions: 4, rule: DEFAULT_SCORING_RULE }).success, false);
  assert.equal(calculateScore({ answers, answerKey: answerKey.slice(1), numQuestions: 4, numOptions: 4, rule: DEFAULT_SCORING_RULE }).success, false);
});

test("el desglose muestra los pasos exactos que producen la nota", () => {
  const result = scoreBreakdown({
    correct: 2,
    wrong: 1,
    blank: 1,
    numQuestions: 4,
    rule: { pointsCorrect: 0.5, pointsWrong: -0.25, pointsBlank: -0.5, maxScore: 20 },
  });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(result.breakdown, {
    correct: 2,
    wrong: 1,
    blank: 1,
    pointsCorrect: "0.5000",
    pointsWrong: "-0.2500",
    pointsBlank: "-0.5000",
    maxScore: "20.0000",
    correctSubtotal: "1.0000",
    wrongSubtotal: "-0.2500",
    blankSubtotal: "-0.5000",
    rawScore: "0.2500",
    boundedRaw: "0.2500",
    maxRaw: "2.0000",
    score: "2.50",
  });
});

test("el desglose acota el bruto negativo y coincide con calculateScore", () => {
  const rule = { pointsCorrect: 1, pointsWrong: -0.5, pointsBlank: -0.25, maxScore: 10 };
  const breakdown = scoreBreakdown({ correct: 0, wrong: 4, blank: 0, numQuestions: 4, rule });
  assert.equal(breakdown.success, true);
  if (!breakdown.success) return;
  assert.equal(breakdown.breakdown.rawScore, "-2.0000");
  assert.equal(breakdown.breakdown.boundedRaw, "0.0000");
  assert.equal(breakdown.breakdown.score, "0.00");
  const score = calculateScore({
    answers: [2, 0, 3, 1].map((optionIndex, index) => ({ questionNo: index + 1, optionIndex })),
    answerKey: [
      { questionNo: 1, correctOption: "A" },
      { questionNo: 2, correctOption: "C" },
      { questionNo: 3, correctOption: "B" },
      { questionNo: 4, correctOption: "D" },
    ],
    numQuestions: 4,
    numOptions: 4,
    rule,
  });
  assert.deepEqual(score, { success: true, summary: { correct: 0, wrong: 4, blank: 0, rawScore: "-2.0000", score: "0.00" } });
});
