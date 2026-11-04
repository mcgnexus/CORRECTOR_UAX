import assert from "node:assert/strict";
import test from "node:test";
import { readOmr, type OmrProfile } from "@/lib/omr/read";
import { detectRegistrationMarkers, type GrayImage } from "@/lib/matrix/detect";

function makeImage(): GrayImage {
  const image: GrayImage = { width: 900, height: 1200, data: new Uint8Array(900 * 1200).fill(255) };
  for (const [cx, cy] of [[60, 60], [840, 60], [60, 1140], [840, 1140]]) {
    for (let y = cy - 6; y <= cy + 6; y += 1) for (let x = cx - 6; x <= cx + 6; x += 1) image.data[y * image.width + x] = 0;
  }
  return image;
}

function disk(image: GrayImage, cx: number, cy: number, radius: number, gray: number) {
  cx = Math.round(cx);
  cy = Math.round(cy);
  for (let y = cy - radius; y <= cy + radius; y += 1) for (let x = cx - radius; x <= cx + radius; x += 1) {
    if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) image.data[y * image.width + x] = gray;
  }
}

const profile: OmrProfile = {
  bubbleRadius: 0.01,
  bubbles: Array.from({ length: 12 }, (_, index) => ({
    questionNo: Math.floor(index / 3) + 1,
    optionIndex: index % 3,
    x: 0.3 + (index % 3) * 0.08,
    y: 0.2 + Math.floor(index / 3) * 0.12,
  })),
};

test("lectura provisional clasifica limpia, blanca, doble y tenue", () => {
  const image = makeImage();
  const center = (x: number, y: number) => ({ x: 60 + x * 780, y: 60 + y * 1080 });
  const clean = center(profile.bubbles[0].x, profile.bubbles[0].y);
  const first = center(profile.bubbles[6].x, profile.bubbles[6].y);
  const second = center(profile.bubbles[7].x, profile.bubbles[7].y);
  const faint = center(profile.bubbles[9].x, profile.bubbles[9].y);
  disk(image, clean.x, clean.y, 5, 0);
  disk(image, first.x, first.y, 5, 0);
  disk(image, second.x, second.y, 5, 0);
  disk(image, faint.x, faint.y, 5, 220);

  const result = readOmr(image, profile, 4, 3);
  assert.deepEqual(result.answers.map(({ flag }) => flag), ["ok", "blank", "multiple", "faint"]);
});

test("rechaza hoja apaisada o a la que le falta una marca", () => {
  const image = makeImage();
  assert.equal(detectRegistrationMarkers(image)?.length, 4);
  const missing = makeImage();
  for (let y = 54; y <= 66; y += 1) for (let x = 54; x <= 66; x += 1) missing.data[y * missing.width + x] = 255;
  assert.equal(detectRegistrationMarkers(missing), undefined);
  assert.equal(detectRegistrationMarkers({ width: 1200, height: 900, data: new Uint8Array(1200 * 900).fill(255) }), undefined);
});
