import assert from "node:assert/strict";
import test from "node:test";
import { applyTonePixels, autoTone, composeCrop, isFullCrop, normalizeSelection, FULL_CROP } from "./retouch";

function image(values: number[], repeats = 1) {
  const data = new Uint8Array(values.length * repeats);
  for (let repeat = 0; repeat < repeats; repeat += 1) {
    data.set(values, repeat * values.length);
  }
  return data;
}

test("vista previa y análisis comparten tono exacto sin acumular y conservan alfa", () => {
  const source = new Uint8ClampedArray([0, 64, 128, 255, 192, 240, 255, 37]);
  const preview = source.slice();
  const analysis = source.slice();
  applyTonePixels(preview, { brightness: 20, contrast: 1.5 });
  applyTonePixels(analysis, { brightness: 20, contrast: 1.5 });
  assert.deepEqual(preview, analysis);
  assert.deepEqual([...preview], [0, 52, 148, 255, 244, 255, 255, 37]);
  for (const brightness of [60, -60, 0]) {
    const restored = source.slice();
    applyTonePixels(restored, { brightness, contrast: 1 });
    if (brightness === 0) assert.deepEqual(restored, source);
  }
  assert.deepEqual([...source], [0, 64, 128, 255, 192, 240, 255, 37]);
});

test("normaliza una selección arrastrada en cualquier dirección", () => {
  const selection = normalizeSelection({ x: 0.7, y: 0.8 }, { x: 0.2, y: 0.1 });
  assert.ok(Math.abs(selection.x - 0.2) < 1e-9 && Math.abs(selection.y - 0.1) < 1e-9);
  assert.ok(Math.abs(selection.w - 0.5) < 1e-9 && Math.abs(selection.h - 0.7) < 1e-9);
  assert.deepEqual(normalizeSelection({ x: -1, y: -1 }, { x: 2, y: 2 }), { x: 0, y: 0, w: 1, h: 1 });
});

test("compone recortes anidados y rechaza selecciones diminutas", () => {
  const parent = { x: 0.1, y: 0.2, w: 0.8, h: 0.6 };
  assert.deepEqual(composeCrop(parent, { x: 0.5, y: 0, w: 0.5, h: 1 }), { x: 0.5, y: 0.2, w: 0.4, h: 0.6 });
  assert.equal(composeCrop(parent, { x: 0.5, y: 0.5, w: 0.01, h: 0.01 }), null);
  assert.equal(isFullCrop(FULL_CROP), true);
  assert.equal(isFullCrop({ x: 0, y: 0, w: 0.9, h: 1 }), false);
});

test("el retoque automático aclara fotos oscuras", () => {
  const gray = image([20, 40, 60, 80, 100, 120], 200);
  const tone = autoTone(gray);
  assert.ok(tone.contrast > 0.6);
  assert.ok(tone.brightness > 0, "Se esperaba aumentar el brillo: " + JSON.stringify(tone));
});

test("el retoque automático reduce el brillo de fotos lavadas", () => {
  const gray = image([200, 210, 220, 230, 240, 250], 200);
  const tone = autoTone(gray);
  assert.ok(tone.brightness < 0, "Se esperaba reducir el brillo: " + JSON.stringify(tone));
});

test("no altera una imagen ya bien expuesta", () => {
  assert.deepEqual(autoTone(image([0, 64, 128, 192, 255], 200)), { brightness: 0, contrast: 1 });
});
