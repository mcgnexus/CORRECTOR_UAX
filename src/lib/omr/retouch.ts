export type CropRect = { x: number; y: number; w: number; h: number };
export type Tone = { brightness: number; contrast: number };

export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };

export function applyTonePixels(data: Uint8ClampedArray, tone: Tone) {
  for (let offset = 0; offset < data.length; offset += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      data[offset + channel] = (data[offset + channel] - 128) * tone.contrast + 128 + tone.brightness;
    }
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function normalizeSelection(start: { x: number; y: number }, end: { x: number; y: number }): CropRect {
  const x = clamp(Math.min(start.x, end.x), 0, 1);
  const y = clamp(Math.min(start.y, end.y), 0, 1);
  const right = clamp(Math.max(start.x, end.x), 0, 1);
  const bottom = clamp(Math.max(start.y, end.y), 0, 1);
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
}

export function composeCrop(parent: CropRect, selection: CropRect): CropRect | null {
  const normalized = normalizeSelection({ x: selection.x, y: selection.y }, { x: selection.x + selection.w, y: selection.y + selection.h });
  if (normalized.w < 0.04 || normalized.h < 0.04) return null;
  return {
    x: parent.x + normalized.x * parent.w,
    y: parent.y + normalized.y * parent.h,
    w: normalized.w * parent.w,
    h: normalized.h * parent.h,
  };
}

export function isFullCrop(crop: CropRect) {
  return crop.x <= 0.001 && crop.y <= 0.001 && crop.w >= 0.999 && crop.h >= 0.999;
}

function percentile(histogram: Uint32Array, total: number, fraction: number) {
  const target = total * fraction;
  let accumulated = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    accumulated += histogram[value];
    if (accumulated >= target) return value;
  }
  return 255;
}

export function autoTone(gray: Uint8Array): Tone {
  if (gray.length === 0) return { brightness: 0, contrast: 1 };
  const histogram = new Uint32Array(256);
  for (let index = 0; index < gray.length; index += 1) histogram[gray[index]] += 1;
  const low = percentile(histogram, gray.length, 0.02);
  const high = percentile(histogram, gray.length, 0.98);
  const range = high - low;

  if (range >= 205 && low <= 24 && high >= 231) return { brightness: 0, contrast: 1 };
  if (range < 8) return { brightness: 0, contrast: 1 };

  const rawContrast = 239 / range;
  const contrast = Math.round(clamp(rawContrast, 0.6, 1.8) * 20) / 20;
  const rawBrightness = -120 - (low - 128) * contrast;
  const brightness = Math.round(clamp(rawBrightness, -60, 60) / 2) * 2;

  if (Math.abs(brightness) < 4 && Math.abs(contrast - 1) < 0.05) return { brightness: 0, contrast: 1 };
  return { brightness, contrast };
}
