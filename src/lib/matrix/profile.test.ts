import assert from "node:assert/strict";
import test from "node:test";
import { matrixProfileInputSchema, matrixProfileProblems } from "@/lib/matrix/profile";

function profile(questions: number, options: number) {
  const rows = Math.ceil(questions / 2);
  const bubbles = [];
  for (let block = 0; block < 2; block += 1) {
    for (let row = 0; row < rows; row += 1) {
      for (let option = 0; option < options; option += 1) {
        bubbles.push({
          questionNo: block * rows + row + 1,
          optionIndex: option,
          x: 0.1 + option * 0.1,
          y: 0.1 + row * 0.05,
        });
      }
    }
  }
  return {
    bubbles: bubbles.filter((bubble) => bubble.questionNo <= questions),
    bubbleRadius: 0.02,
    rowsPerBlock: rows,
    blocks: 2,
    optionsPerBlock: options,
  };
}

test("acepta una calibración completa compatible con el examen", () => {
  const input = matrixProfileInputSchema.parse(profile(10, 4));
  assert.deepEqual(matrixProfileProblems(input, 10, 4), []);
});

test("detecta desajustes de filas, opciones y burbujas", () => {
  const input = matrixProfileInputSchema.parse(profile(10, 4));
  assert.ok(matrixProfileProblems(input, 20, 4).length > 0);
  assert.ok(matrixProfileProblems(input, 10, 5).length > 0);
  assert.ok(matrixProfileProblems({ ...input, bubbles: input.bubbles.slice(0, 20) }, 10, 4).length > 0);
});

test("rechaza coordenadas fuera de rango", () => {
  assert.equal(
    matrixProfileInputSchema.safeParse({
      ...profile(10, 4),
      bubbles: [{ questionNo: 1, optionIndex: 0, x: 1.5, y: 0 }],
    }).success,
    false,
  );
});
