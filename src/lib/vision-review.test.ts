import assert from "node:assert/strict";
import test from "node:test";
import { visionReview } from "./vision-review";

test("vision suggestions require explicit confirmation for every row", () => {
  const answers = Array.from({ length: 40 }, (_, i) => ({ questionNo: i + 1, selectedOption: i === 0 ? 2 : null, flag: i === 0 ? "ok" : "blank" }));
  const review = visionReview({ answers }, 40);
  assert.equal(review.length, 40);
  assert.equal(review[0].selectedOption, 2);
  assert.ok(review.every((row) => !row.confirmed && row.confidence === null));
});

test("vision review rejects duplicates and inconsistent ambiguous marks", () => {
  const answers = Array.from({ length: 40 }, (_, i) => ({ questionNo: i + 1, selectedOption: null, flag: "blank" }));
  assert.throws(() => visionReview({ answers: answers.map((a, i) => i === 39 ? { ...a, questionNo: 1 } : a) }, 40));
  assert.throws(() => visionReview({ answers: answers.map((a, i) => i === 0 ? { ...a, selectedOption: 1, flag: "multiple" } : a) }, 40));
});

test("ambiguous vision answers are explicitly unresolved", () => {
  const answers = Array.from({ length: 40 }, (_, i) => ({ questionNo: i + 1, selectedOption: null, flag: i === 0 ? "multiple" : "blank" }));
  const review = visionReview({ answers }, 40);
  assert.equal(review[0].unresolved, true);
  assert.equal(review[1].unresolved, false);
});

test("vision review accepts the exam's question count", () => {
  const answers = Array.from({ length: 30 }, (_, i) => ({ questionNo: i + 1, selectedOption: null, flag: "blank" }));
  assert.equal(visionReview({ answers }, 30).length, 30);
  assert.throws(() => visionReview({ answers }, 31));
  assert.throws(() => visionReview({ answers: answers.map((a, i) => i === 29 ? { ...a, questionNo: 31 } : a) }, 30));
});
