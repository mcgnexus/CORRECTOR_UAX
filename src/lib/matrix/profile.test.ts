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
          y: 0.1 + row * 0.8 / rows,
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
  assert.notEqual(input.format, "uax-grid-40");
  assert.deepEqual(matrixProfileProblems(input, 10, 4), []);
});

function uaxProfile() {
  return {
    format: "uax-grid-40", version: 1, rowsPerBlock: 20, blocks: 2, optionsPerBlock: 4,
    tables: [0.1, 0.6].map((x) => ({
      corners: [{ x, y: 0.1 }, { x: x + 0.3, y: 0.1 }, { x: x + 0.3, y: 0.9 }, { x, y: 0.9 }],
      reference: Buffer.alloc(320 * 880, 255).toString("base64"),
    })),
  };
}

test("acepta UAX v1 y exige dimensiones y formato compatibles", () => {
  const input = matrixProfileInputSchema.parse(uaxProfile());
  assert.deepEqual(matrixProfileProblems(input, 40, 4, "uax-grid-40"), []);
  assert.ok(matrixProfileProblems(input, 40, 4, "bubbles").length);
  assert.ok(matrixProfileProblems(input, 39, 4, "uax-grid-40").length);
  assert.ok(matrixProfileProblems(matrixProfileInputSchema.parse(profile(40, 4)), 40, 4, "uax-grid-40").length);
});

test("rechaza UAX incompleto, referencias invalidas y esquinas degeneradas", () => {
  const input = uaxProfile();
  for (const invalid of [
    { ...input, version: undefined }, { ...input, tables: input.tables.slice(0, 1) },
    { ...input, bubbles: [] }, { ...input, format: undefined },
    { ...input, tables: input.tables.map((table) => ({ ...table, reference: "AAAA" })) },
    { ...input, tables: input.tables.map((table) => ({ ...table, reference: "!".repeat(375468) })) },
    { ...input, tables: input.tables.map((table) => ({ ...table, corners: Array(4).fill({ x: 0, y: 0 }) })) },
    { ...input, tables: [...input.tables].reverse() },
  ]) assert.equal(matrixProfileInputSchema.safeParse(invalid).success, false);
});

test("acepta burbujas antiguas y discriminadas sin reinterpretar UAX", () => {
  assert.equal(matrixProfileInputSchema.safeParse(profile(40, 4)).success, true);
  assert.equal(matrixProfileInputSchema.safeParse({ ...profile(40, 4), format: "bubbles", version: 1 }).success, true);
  assert.equal(matrixProfileInputSchema.safeParse({ ...profile(40, 4), format: "uax-grid-40" }).success, false);
});

test("detecta desajustes de filas, opciones y burbujas", () => {
  const input = matrixProfileInputSchema.parse(profile(10, 4));
  assert.ok(input.format !== "uax-grid-40");
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
