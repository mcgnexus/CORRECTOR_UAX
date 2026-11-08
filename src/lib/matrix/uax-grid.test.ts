import assert from "node:assert/strict";
import test from "node:test";
import { syntheticUax } from "../../../tests/fixtures/uax-grid/synthetic";
import { calibrateUaxGrid, detectUaxTables, projectUaxPoint, rectifyUaxTable } from "./uax-grid";
import { matrixProfileInputSchema } from "./profile";

test("UAX detects two complete grids, ignores header and orders left/right", () => {
  const { image, tables } = syntheticUax();
  const found = detectUaxTables(image);
  assert.equal(found?.length, 2);
  found!.forEach((table, i) => table.corners.forEach((point, j) => {
    assert.ok(Math.hypot(point.x - tables[i].corners[j].x, point.y - tables[i].corners[j].y) < 4);
  }));
  const reference = calibrateUaxGrid(image, tables);
  assert.equal(reference.format, "uax-grid-40");
  assert.equal(matrixProfileInputSchema.safeParse(reference).success, true);
  assert.equal(atob(reference.tables[0].reference).length, 320 * 880);
  assert.ok(reference.tables[0].corners.every(p => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1));
  assert.equal(rectifyUaxTable(image, tables[0]).data.length, 320 * 880);
  assert.deepEqual(projectUaxPoint(tables[0], 1.5 / 5, .5 / 20), { x: 166, y: 252 });
  assert.deepEqual(projectUaxPoint(tables[1], 4.5 / 5, 19.5 / 20), { x: 798, y: 1088 });
});

test("UAX conservative detector supports mild perspective, rotation and scale", () => {
  for (const transform of [
    [.91, -.05, 80, .05, .91, 0, 0, 0],
    [1, .03, 5, .02, 1, 0, .00008, .00004],
    [.75, 0, 30, 0, .75, 20, 0, 0],
  ] as [number, number, number, number, number, number, number, number][]) {
    const { image, tables } = syntheticUax({ transform });
    const found = detectUaxTables(image);
    assert.equal(found?.length, 2, JSON.stringify(transform));
    assert.doesNotThrow(() => calibrateUaxGrid(image, tables));
  }
});

test("UAX rejects missing, cropped, wrong-row and non-grid manual tables", () => {
  assert.equal(detectUaxTables(syntheticUax({ missing: 1 }).image), null);
  assert.equal(detectUaxTables(syntheticUax({ rows: 19 }).image), null);
  const { image, tables } = syntheticUax();
  assert.throws(() => calibrateUaxGrid(image, [tables[1], tables[0]]), /orden|izquierda/i);
  const invalid = [
    { corners: [tables[0].corners[0], tables[0].corners[0], tables[0].corners[2], tables[0].corners[3]] },
    { corners: [tables[0].corners[0], tables[0].corners[2], tables[0].corners[1], tables[0].corners[3]] },
    { corners: [{ x: -1, y: 230 }, ...tables[0].corners.slice(1)] },
    { corners: [{ x: 70, y: 35 }, { x: 830, y: 35 }, { x: 830, y: 130 }, { x: 70, y: 130 }] },
    { corners: tables[0].corners.map(p => ({ x: p.x, y: p.y + 22 })) },
  ];
  for (const table of invalid) assert.throws(() => calibrateUaxGrid(image, [table as typeof tables[0], tables[1]]));
  const white = { ...image, data: new Uint8Array(image.data.length).fill(255) };
  assert.throws(() => calibrateUaxGrid(white, tables), /estructura|cuadrícula/i);
  assert.throws(() => calibrateUaxGrid(syntheticUax({ rows: 19 }).image, tables));
});

test("UAX refuses an annotated reference instead of learning marks as printing", () => {
  for (const kind of ["cross", "circle", "scratch"] as const) {
    const { image, tables } = syntheticUax({ marks: [{ q: 1, option: 0, kind }] });
    assert.throws(() => calibrateUaxGrid(image, tables), /blanco|trazos/i);
  }
});

test("UAX rejects strongly rotated overlapping x-ranges required by persisted profile contract", () => {
  const { image, tables } = syntheticUax({ transform: [.98, -.17, 210, .17, .98, -10, 0, 0] });
  assert.throws(() => calibrateUaxGrid(image, tables), /orden|solap|izquierda/i);
});

test("UAX detector refuses three complete candidate tables rather than choosing an arbitrary pair", () => {
  const source = syntheticUax().image;
  const image = { width: 1500, height: source.height, data: new Uint8Array(1500 * source.height).fill(255) };
  for (let y = 0; y < image.height; y++) {
    image.data.set(source.data.subarray(y * source.width, (y + 1) * source.width), y * image.width);
    image.data.set(source.data.subarray(y * source.width + 69, y * source.width + 392), y * image.width + 1049);
  }
  assert.equal(detectUaxTables(image), null);
});

test("UAX accepts lightly printed real sheets judged by contrast, not by a fixed fraction of the brightest pixel", () => {
  const { image, tables } = syntheticUax({ printGray: 200 });
  const profile = calibrateUaxGrid(image, tables);
  assert.equal(profile.format, "uax-grid-40");
});

test("UAX tolerates corners marked a few pixels off before the lattice drifts beyond the search window", () => {
  const { image, tables } = syntheticUax();
  const moved: typeof tables = [
    { corners: tables[0].corners.map((p, i) => i >= 2 ? { x: p.x, y: p.y + 8 } : p) as typeof tables[0]["corners"] },
    tables[1],
  ];
  const profile = calibrateUaxGrid(image, moved);
  assert.equal(profile.format, "uax-grid-40");
});

test("UAX lattice failure reports which lines failed and their support", () => {
  const white = { ...syntheticUax().image, data: new Uint8Array(1000 * 1250).fill(255) };
  assert.throws(() => calibrateUaxGrid(white, syntheticUax().tables), /estructura[\s\S]*(soporte|línea)[\s\S]*%/i);
});

test("UAX still rejects corners shifted half a cell or badly misaligned tables", () => {
  const { image, tables } = syntheticUax();
  const shifted: typeof tables = [
    { corners: tables[0].corners.map(p => ({ x: p.x, y: p.y + 22 })) as typeof tables[0]["corners"] },
    tables[1],
  ];
  assert.throws(() => calibrateUaxGrid(image, shifted), /estructura|cuadrícula/i);
  assert.throws(() => calibrateUaxGrid(image, [tables[1], tables[0]]), /orden|izquierda/i);
});
