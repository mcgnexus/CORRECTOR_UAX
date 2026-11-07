import assert from "node:assert/strict";
import test from "node:test";
import { demoExamId, examDemo, isDemoConfirmation } from "./exam-demo";
import { answerKeyProblems } from "./answer-key";
import { calculateScore, DEFAULT_SCORING_RULE } from "./scoring";

test("el ejemplo es ficticio, tiene clave manual revisable y entregas completas con blancos", () => {
  assert.match(examDemo.title, /ficticio/i);
  assert.equal(examDemo.status, "key_pending");
  assert.deepEqual(answerKeyProblems(examDemo.key.map((item) => ({ q: item.questionNo, answer: item.correctOption })), examDemo.numQuestions, examDemo.numOptions), []);
  assert.ok(examDemo.students.some((student) => student.answers === null));
  assert.ok(examDemo.students.some((student) => student.answers?.some((answer) => answer.optionIndex === null)));
  for (const student of examDemo.students) {
    assert.equal(student.dni, null);
    assert.match(student.name, /fictici/i);
    if (!student.answers) continue;
    const scored = calculateScore({ answers: student.answers, answerKey: examDemo.key,
      numQuestions: examDemo.numQuestions, numOptions: examDemo.numOptions, rule: DEFAULT_SCORING_RULE });
    assert.equal(scored.success, true);
    if (scored.success) assert.equal(scored.summary.score, student.expectedScore);
  }
  assert.match(examDemo.aiText, /1\./);
  assert.match(examDemo.aiText, /4\./);
});

test("identidad de demo estable por cuenta y distinta entre cuentas", () => {
  const owner = "00000000-0000-4000-8000-000000000001";
  assert.equal(demoExamId(owner), demoExamId(owner));
  assert.notEqual(demoExamId(owner), demoExamId("00000000-0000-4000-8000-000000000002"));
  assert.match(demoExamId(owner), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("crear ejemplo exige confirmacion explicita y no acepta propietario ni duplicacion", () => {
  assert.equal(isDemoConfirmation({ confirmation: "CREAR EJEMPLO FICTICIO" }), true);
  for (const input of [null, {}, [], { confirmation: false }, { confirmation: "crear" },
    { confirmation: "CREAR EJEMPLO FICTICIO", ownerId: "otro" },
    { confirmation: "CREAR EJEMPLO FICTICIO", duplicate: true }]) {
    assert.equal(isDemoConfirmation(input), false);
  }
});
