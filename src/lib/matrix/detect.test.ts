import assert from "node:assert/strict";
import test from "node:test";
import { calibrateMatrix, detectRegistrationMarkers, markersFromPoints, markerSpans, projectMatrixPoint, type GrayImage } from "@/lib/matrix/detect";
import { readOmr } from "@/lib/omr/read";

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

type TemplateSheet = {
  image: GrayImage;
  markers: Array<{ x: number; y: number }>;
  centers: Map<string, { x: number; y: number }>;
  radius: number;
};

function buildTemplateSheet(options: { questions: number; options: number; falseCorners?: boolean; skip?: { questionNo: number; optionIndex: number } }): TemplateSheet {
  const width = 800;
  const height = 1100;
  const image: GrayImage = { width, height, data: new Uint8Array(width * height).fill(255) };
  const rectangle = (x: number, y: number, w: number, h: number) => {
    for (let py = y; py < y + h; py += 1) for (let px = x; px < x + w; px += 1) image.data[py * width + px] = 0;
  };

  rectangle(40, 20, 160, 3);
  rectangle(40, 88, 160, 3);
  rectangle(40, 20, 3, 70);
  rectangle(197, 20, 3, 70);
  rectangle(80, 110, 620, 5);
  rectangle(120, 130, 560, 5);
  rectangle(250, 150, 300, 5);

  if (options.falseCorners !== false) {
    for (const [x, y] of [[30, 30], [770, 30], [30, 250], [770, 250]] as const) rectangle(x - 7, y - 7, 14, 14);
  }

  const markers = [{ x: 120, y: 320 }, { x: 680, y: 320 }, { x: 120, y: 1000 }, { x: 680, y: 1000 }];
  for (const marker of markers) rectangle(marker.x - 7, marker.y - 7, 14, 14);

  const rows = Math.ceil(options.questions / 2);
  const radius = 6;
  for (let column = 0; column < options.options; column += 1) rectangle(200 + column * 40 - 3, 336, 6, 12);
  for (let column = 0; column < options.options; column += 1) rectangle(470 + column * 40 - 3, 336, 6, 12);

  const centers = new Map<string, { x: number; y: number }>();
  for (let row = 0; row < rows; row += 1) {
    const y = 360 + row * 24;
    rectangle(167, y - 7, 6, 14);
    rectangle(437, y - 7, 6, 14);
    if (row >= 9 && row % 10 === 9) {
      ring(image, 170, y, 4, 2);
      ring(image, 440, y, 4, 2);
    }
    for (let option = 0; option < options.options; option += 1) {
      const questions = [row + 1, rows + row + 1];
      for (let block = 0; block < 2; block += 1) {
        const questionNo = questions[block];
        if (questionNo > options.questions) continue;
        const x = (block === 0 ? 200 : 470) + option * 40;
        if (options.skip && options.skip.questionNo === questionNo && options.skip.optionIndex === option) continue;
        ring(image, x, y, radius, 2);
        centers.set(questionNo + ":" + option, { x, y });
      }
    }
  }

  return { image, markers, centers, radius };
}

test("calibra la plantilla con cabecera y marcas falsas en las esquinas de la página", () => {
  const sheet = buildTemplateSheet({ questions: 50, options: 4 });
  assert.equal(detectRegistrationMarkers(sheet.image)?.length, 4);
  const result = calibrateMatrix(sheet.image, { numQuestions: 50, numOptions: 4 });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.calibration.bubbles.length, 200);
  const differences = result.calibration.markers.map((marker, index) =>
    Math.hypot(marker.x - sheet.markers[index].x, marker.y - sheet.markers[index].y),
  );
  assert.ok(Math.max(...differences) <= 2, "Marcas fuera de tolerancia: " + differences.join(", "));
  let maxError = 0;
  for (const bubble of result.calibration.bubbles) {
    const expected = sheet.centers.get(bubble.questionNo + ":" + bubble.optionIndex);
    assert.ok(expected, "Falta el centro esperado");
    const projected = projectMatrixPoint(result.calibration.markers, bubble.x, bubble.y);
    maxError = Math.max(maxError, Math.hypot(projected.x - expected!.x, projected.y - expected!.y));
  }
  assert.ok(maxError <= 2.5, "Error máximo de centro: " + maxError.toFixed(2) + "px");
  const radiusPx = result.calibration.bubbleRadius * markerSpans(result.calibration.markers).min;
  assert.ok(Math.abs(radiusPx - sheet.radius) <= 1.5, "Radio: " + radiusPx.toFixed(2));
});

test("rechaza la calibración si falta una burbuja de la rejilla", () => {
  const sheet = buildTemplateSheet({ questions: 10, options: 4, skip: { questionNo: 7, optionIndex: 2 } });
  const result = calibrateMatrix(sheet.image, { numQuestions: 10, numOptions: 4 });
  assert.equal(result.success, false);
  if (result.success) return;
  assert.match(result.error, /pregunta 7/);
});

test("calibra una matriz de una sola fila sin acceder a filas inexistentes", () => {
  const sheet = buildTemplateSheet({ questions: 2, options: 4 });
  const result = calibrateMatrix(sheet.image, { numQuestions: 2, numOptions: 4 });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.calibration.rowsPerBlock, 1);
  assert.equal(result.calibration.bubbles.length, 8);
});

test("lee respuestas marcadas usando el perfil calibrado de la plantilla realista", () => {
  const sheet = buildTemplateSheet({ questions: 50, options: 4 });
  const calibration = calibrateMatrix(sheet.image, { numQuestions: 50, numOptions: 4 });
  assert.equal(calibration.success, true);
  if (!calibration.success) return;
  const fill = (questionNo: number, optionIndex: number) => {
    const center = sheet.centers.get(questionNo + ":" + optionIndex)!;
    for (let y = center.y - 5; y <= center.y + 5; y += 1) {
      for (let x = center.x - 5; x <= center.x + 5; x += 1) {
        if ((x - center.x) ** 2 + (y - center.y) ** 2 <= 25) sheet.image.data[y * sheet.image.width + x] = 0;
      }
    }
  };
  fill(1, 0);
  fill(26, 1);
  const result = readOmr(sheet.image, {
    bubbles: calibration.calibration.bubbles,
    bubbleRadius: calibration.calibration.bubbleRadius,
  }, 50, 4);
  assert.equal(result.answers.length, 50);
  assert.equal(result.answers[0].detected, 0);
  assert.equal(result.answers[0].flag, "ok");
  assert.equal(result.answers[25].detected, 1);
  assert.equal(result.answers[25].flag, "ok");
});
