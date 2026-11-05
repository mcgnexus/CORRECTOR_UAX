import assert from "node:assert/strict";
import test from "node:test";
import { calibrateMatrix, detectRegistrationMarkers, markersFromPoints, type GrayImage } from "@/lib/matrix/detect";

function blank(width: number, height: number): GrayImage {
  const data = new Uint8Array(width * height).fill(255);
  return { width, height, data };
}

function square(image: GrayImage, cx: number, cy: number, size: number) {
  for (let y = cy - size / 2; y < cy + size / 2; y += 1) {
    for (let x = cx - size / 2; x < cx + size / 2; x += 1) {
      image.data[Math.round(y) * image.width + Math.round(x)] = 0;
    }
  }
}

function ring(image: GrayImage, cx: number, cy: number, radius: number, thickness = 2) {
  for (let y = Math.floor(cy - radius - thickness); y <= cy + radius + thickness; y += 1) {
    for (let x = Math.floor(cx - radius - thickness); x <= cx + radius + thickness; x += 1) {
      const distance = Math.hypot(x - cx, y - cy);
      if (distance <= radius && distance >= radius - thickness) {
        image.data[y * image.width + x] = 0;
      }
    }
  }
}

function buildSheet(questions: number, options: number, optionsPerPage = options) {
  const image = blank(900, 1200);
  const markerSize = 12;
  square(image, 60, 60, markerSize);
  square(image, 840, 60, markerSize);
  square(image, 60, 1140, markerSize);
  square(image, 840, 1140, markerSize);

  const rows = Math.ceil(questions / 2);
  const leftStart = 170;
  const rightStart = 530;
  for (let row = 0; row < rows; row += 1) {
    const y = 140 + row * 40;
    for (let option = 0; option < optionsPerPage; option += 1) {
      ring(image, leftStart + option * 34, y, 7);
      ring(image, rightStart + option * 34, y, 7);
    }
  }
  return image;
}

test("detecta marcas, bloques y burbujas en una matriz sintética", () => {
  const image = buildSheet(10, 4);
  const result = calibrateMatrix(image, { numQuestions: 10, numOptions: 4 });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.calibration.markers.length, 4);
  assert.equal(result.calibration.blocks, 2);
  assert.equal(result.calibration.rowsPerBlock, 5);
  assert.equal(result.calibration.optionsPerBlock, 4);
  assert.equal(result.calibration.bubbles.length, 40);
  for (const bubble of result.calibration.bubbles) {
    assert.ok(bubble.x >= 0 && bubble.x <= 1);
    assert.ok(bubble.y >= 0 && bubble.y <= 1);
  }
  const unique = new Set(result.calibration.bubbles.map((bubble) => `${bubble.questionNo}:${bubble.optionIndex}`));
  assert.equal(unique.size, 40);
});

test("infiere la cuarta marca cuando falta una esquina", () => {
  const image = buildSheet(10, 4);
  square(image, 60, 1140, 12);
  for (let y = 1130; y < 1150; y += 1) {
    for (let x = 50; x < 70; x += 1) image.data[y * image.width + x] = 255;
  }
  const result = calibrateMatrix(image, { numQuestions: 10, numOptions: 4 });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.calibration.markers.length, 4);
  assert.equal(result.calibration.bubbles.length, 40);
});

test("rechaza imágenes demasiado pequeñas", () => {
  const result = calibrateMatrix(blank(100, 100), { numQuestions: 10, numOptions: 4 });
  assert.equal(result.success, false);
});

test("rechaza una imagen sin marcas", () => {
  const result = calibrateMatrix(blank(900, 1200), { numQuestions: 10, numOptions: 4 });
  assert.equal(result.success, false);
});

test("ordena cuatro esquinas marcadas en cualquier orden como tl, tr, bl y br", () => {
  const markers = markersFromPoints([
    { x: 840, y: 60 },
    { x: 60, y: 1140 },
    { x: 840, y: 1140 },
    { x: 60, y: 60 },
  ]);
  assert.ok(markers);
  assert.deepEqual(markers?.map((marker) => [Math.round(marker.x), Math.round(marker.y)]), [[60, 60], [840, 60], [60, 1140], [840, 1140]]);
  assert.equal(markersFromPoints([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 10 }]), undefined);
});

test("detecta marcas tenues con umbral adaptativo", () => {
  const image = blank(900, 1200);
  const faint = (cx: number, cy: number, size: number) => {
    for (let y = cy - size / 2; y < cy + size / 2; y += 1) {
      for (let x = cx - size / 2; x < cx + size / 2; x += 1) {
        image.data[Math.round(y) * image.width + Math.round(x)] = 205;
      }
    }
  };
  faint(60, 60, 14);
  faint(840, 60, 14);
  faint(60, 1140, 14);
  faint(840, 1140, 14);
  assert.equal(detectRegistrationMarkers(image)?.length, 4);
});

test("permite calibrar con esquinas indicadas manualmente aunque no se detecten las marcas", () => {
  const image = buildSheet(10, 4);
  for (let y = 50; y < 70; y += 1) {
    for (let x = 50; x < 70; x += 1) image.data[y * image.width + x] = 255;
  }
  const manual = markersFromPoints([
    { x: 60, y: 60 },
    { x: 840, y: 60 },
    { x: 60, y: 1140 },
    { x: 840, y: 1140 },
  ]);
  assert.ok(manual);
  const result = calibrateMatrix(image, { numQuestions: 10, numOptions: 4 }, manual);
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.calibration.bubbles.length, 40);
});
