import assert from "node:assert/strict";
import test from "node:test";
import { hashReviewedRequest } from "@/lib/idempotency";

const first = {
  studentId: "00000000-0000-4000-8000-000000000001",
  answers: [{ questionNo: 2, optionIndex: 1 }, { optionIndex: 0, questionNo: 1 }],
  replace: true,
  expectedVersion: 4,
};

test("hash de idempotencia normaliza orden de claves y preguntas", () => {
  const reordered = {
    expectedVersion: 4,
    replace: true,
    studentId: first.studentId,
    answers: [{ questionNo: 1, optionIndex: 0 }, { questionNo: 2, optionIndex: 1 }],
  };
  assert.equal(hashReviewedRequest(first), hashReviewedRequest(reordered));
});

test("el hash distingue respuestas, reemplazo y versión", () => {
  assert.notEqual(hashReviewedRequest(first), hashReviewedRequest({ ...first, replace: false }));
  assert.notEqual(hashReviewedRequest(first), hashReviewedRequest({ ...first, expectedVersion: 3 }));
  assert.notEqual(hashReviewedRequest(first), hashReviewedRequest({ ...first, answers: [{ questionNo: 1, optionIndex: 2 }] }));
});
