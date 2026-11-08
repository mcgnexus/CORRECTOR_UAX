import assert from "node:assert/strict";
import test from "node:test";
import { syntheticUax, type Mark } from "../../../tests/fixtures/uax-grid/synthetic";
import { calibrateUaxGrid, detectUaxTables } from "../matrix/uax-grid";
import { readUaxGrid } from "./read-uax-grid";

const blank = syntheticUax();
const profile = calibrateUaxGrid(blank.image, blank.tables);

test("UAX printed letters, lines and numbering alone produce exactly 40 blanks", () => {
  const result = readUaxGrid(blank.image, profile, blank.tables);
  assert.equal(result.answers.length, 40);
  assert.deepEqual(result.answers.map(a => a.q), Array.from({ length: 40 }, (_, i) => i + 1));
  assert.ok(result.answers.every(a => a.flag === "blank" && a.detected === null));
});

test("UAX reads crosses/circles on A-D and preserves first/last question in both blocks", () => {
  const marks: Mark[] = Array.from({ length: 40 }, (_, i) => ({ q: i + 1, option: i % 4, kind: i % 2 ? "circle" : "cross" }));
  const capture = syntheticUax({ marks });
  const result = readUaxGrid(capture.image, profile, capture.tables);
  result.answers.forEach((a, i) => {
    assert.equal(a.detected, i % 4, `q=${a.q}`);
    assert.equal(a.flag, "ok", `q=${a.q}`);
    assert.ok(a.confidence > 0 && a.confidence <= 1);
  });
});

test("UAX double, faint and scratched marks require review, not a safe single choice", () => {
  const capture = syntheticUax({ marks: [
    { q: 1, option: 0, kind: "cross" }, { q: 1, option: 2, kind: "circle" },
    { q: 20, option: 3, kind: "cross", gray: 175 },
    { q: 21, option: 1, kind: "scratch" },
  ] });
  const answers = readUaxGrid(capture.image, profile, capture.tables).answers;
  assert.equal(answers[0].flag, "multiple");
  assert.equal(answers[0].detected, null);
  assert.equal(answers[19].flag, "faint");
  assert.equal(answers[20].flag, "faint");
  assert.ok(answers.filter(a => ![1, 20, 21].includes(a.q)).every(a => a.flag === "blank"));
});

test("UAX tolerates mild perspective/scale, print intensity, shadow and small corner error", () => {
  const marks: Mark[] = [{ q: 1, option: 3, kind: "cross" }, { q: 40, option: 0, kind: "circle" }];
  const capture = syntheticUax({ marks, shade: true, printGray: 100,
    transform: [.92, -.025, 40, .025, .92, 5, .00003, .00002] });
  for (const tables of [capture.tables, detectUaxTables(capture.image)!, capture.tables.map(t => ({ corners: t.corners.map(p => ({ x: p.x + 1, y: p.y + 1 })) as typeof t.corners }))]) {
    assert.ok(tables);
    const result = readUaxGrid(capture.image, profile, tables);
    assert.equal(result.answers[0].detected, 3);
    assert.equal(result.answers[39].detected, 0);
    assert.ok(result.answers.slice(1, 39).every(a => a.flag === "blank"));
  }
});

test("UAX rejects incompatible valid-length baselines and bad alignment instead of forty silent blanks", () => {
  const alternate = syntheticUax({ alternateLetters: true });
  assert.throws(() => readUaxGrid(alternate.image, profile, alternate.tables), /referencia|alineaci/i);
  const allWhite = { ...profile, tables: profile.tables.map(t => ({ ...t, reference: btoa(String.fromCharCode(255).repeat(320 * 880)) })) as typeof profile.tables };
  assert.throws(() => readUaxGrid(blank.image, allWhite, blank.tables), /referencia/i);
  const shifted = blank.tables.map(t => ({ corners: t.corners.map(p => ({ x: p.x + 10, y: p.y })) as typeof t.corners }));
  assert.throws(() => readUaxGrid(blank.image, profile, shifted), /estructura|alineaci|cuadricula/i);
  assert.throws(() => readUaxGrid(syntheticUax({ missing: 1 }).image, profile), /tablas|captura/i);
  assert.throws(() => readUaxGrid(blank.image, profile, [blank.tables[1], blank.tables[0]]), /orden/i);
});

test("UAX malformed reference is rejected before decoding, even with matching table geometry", () => {
  for (const reference of ["", "!".repeat(375468), "A".repeat(375468), profile.tables[0].reference + "AAAA"]) {
    const bad = { ...profile, tables: [{ ...profile.tables[0], reference }, profile.tables[1]] as typeof profile.tables };
    assert.throws(() => readUaxGrid(blank.image, bad, blank.tables), /referencia/i);
  }
});

test("UAX accepts a whole marked column, not only sparse handwritten cells", () => {
  for (const kind of ["cross", "circle"] as const) {
    const marks: Mark[] = Array.from({ length: 40 }, (_, i) => ({ q: i + 1, option: 0, kind }));
    const capture = syntheticUax({ marks });
    const result = readUaxGrid(capture.image, profile, capture.tables);
    assert.ok(result.answers.every(a => a.detected === 0 && a.flag === "ok"));
  }
});

test("UAX refuses lost printing in one row, even if the grid lines survive", () => {
  const capture = syntheticUax();
  for (let y = 230 + 5 * 44 + 5; y < 230 + 6 * 44 - 5; y++) {
    for (let x = 70 + 64 + 5; x < 390 - 5; x++) {
      if ((x - 70) % 64 < 5 || (x - 70) % 64 > 59) continue;
      capture.image.data[y * capture.image.width + x] = 255;
    }
  }
  assert.throws(() => readUaxGrid(capture.image, profile, capture.tables), /referencia|alineaci|impresi/i);
});

test("UAX checks both references and normalized geometry before any base64 decoding", t => {
  const decoder = t.mock.method(globalThis, "atob");
  const badInputs = [
    { ...profile, tables: [profile.tables[0], { ...profile.tables[1], reference: "bad" }] },
    { ...profile, tables: [{ ...profile.tables[0], reference: profile.tables[0].reference.slice(0, -2) + "9=" }, profile.tables[1]] },
    { ...profile, tables: [{ ...profile.tables[0], corners: Array(4).fill({ x: .1, y: .2 }) }, profile.tables[1]] },
    { ...profile, tables: [profile.tables[1], profile.tables[0]] },
  ];
  for (const bad of badInputs) {
    assert.throws(() => readUaxGrid(blank.image, bad as typeof profile, blank.tables), /referencia/i);
    assert.equal(decoder.mock.callCount(), 0);
  }
});

test("UAX rejects swapped table reference content, even when normalized corners remain ordered", () => {
  const swapped = { ...profile, tables: [
    { ...profile.tables[0], reference: profile.tables[1].reference },
    { ...profile.tables[1], reference: profile.tables[0].reference },
  ] as typeof profile.tables };
  assert.throws(() => readUaxGrid(blank.image, swapped, blank.tables), /referencia|alineaci|numeraci/i);
});
