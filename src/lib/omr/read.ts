import { detectRegistrationMarkers, projectMatrixPoint, type GrayImage, type MatrixMarker } from "@/lib/matrix/detect";

export type OmrProfile = {
  bubbles: Array<{ questionNo: number; optionIndex: number; x: number; y: number }>;
  bubbleRadius: number;
};

export type OmrAnswer = {
  q: number;
  detected: number | null;
  confidence: number;
  flag: "ok" | "blank" | "multiple" | "faint";
};

export type OmrResult = { markers: MatrixMarker[]; answers: OmrAnswer[] };

function sample(image: GrayImage, x: number, y: number, radius: number) {
  let total = 0;
  let count = 0;
  const r = Math.max(2, radius);
  for (let py = Math.max(0, Math.floor(y - r)); py <= Math.min(image.height - 1, Math.ceil(y + r)); py += 1) {
    for (let px = Math.max(0, Math.floor(x - r)); px <= Math.min(image.width - 1, Math.ceil(x + r)); px += 1) {
      if ((px - x) ** 2 + (py - y) ** 2 <= r ** 2) {
        total += image.data[py * image.width + px];
        count += 1;
      }
    }
  }
  return count ? total / count : 255;
}

function sampleRing(image: GrayImage, x: number, y: number, inner: number, outer: number) {
  let total = 0;
  let count = 0;
  for (let py = Math.max(0, Math.floor(y - outer)); py <= Math.min(image.height - 1, Math.ceil(y + outer)); py += 1) {
    for (let px = Math.max(0, Math.floor(x - outer)); px <= Math.min(image.width - 1, Math.ceil(x + outer)); px += 1) {
      const distance = Math.hypot(px - x, py - y);
      if (distance >= inner && distance <= outer) {
        total += image.data[py * image.width + px];
        count += 1;
      }
    }
  }
  return count ? total / count : 255;
}

export function readOmr(
  image: GrayImage,
  profile: OmrProfile,
  numQuestions: number,
  numOptions: number,
  manualMarkers?: MatrixMarker[],
): OmrResult {
  if (image.data.length !== image.width * image.height) throw new Error("La imagen no tiene un formato válido.");
  let total = 0;
  let squared = 0;
  let gradient = 0;
  let samples = 0;
  for (let y = 2; y < image.height - 2; y += 4) {
    for (let x = 2; x < image.width - 2; x += 4) {
      const value = image.data[y * image.width + x];
      total += value;
      squared += value * value;
      gradient += Math.abs(value - image.data[y * image.width + x + 2]) + Math.abs(value - image.data[(y + 2) * image.width + x]);
      samples += 1;
    }
  }
  const mean = total / samples;
  const deviation = Math.sqrt(Math.max(0, squared / samples - mean * mean));
  if (mean < 20 || mean > 254.9 || deviation < 1.2) throw new Error("La iluminación es insuficiente o está saturada. Repite la foto con luz uniforme y sin reflejos.");
  if (gradient / (samples * 2) < 0.04) throw new Error("La imagen está demasiado borrosa. Mantén el móvil quieto y repite la captura.");
  const markers = manualMarkers && manualMarkers.length === 4 ? manualMarkers : detectRegistrationMarkers(image);
  if (!markers) throw new Error("No se detectan cuatro marcas completas. Puedes marcarlas manualmente en la pantalla.");
  const spanX = (Math.hypot(markers[1].x - markers[0].x, markers[1].y - markers[0].y) + Math.hypot(markers[3].x - markers[2].x, markers[3].y - markers[2].y)) / 2;
  const spanY = (Math.hypot(markers[2].x - markers[0].x, markers[2].y - markers[0].y) + Math.hypot(markers[3].x - markers[1].x, markers[3].y - markers[1].y)) / 2;
  if (image.width < 600 || image.height < 800) throw new Error("La resolución es insuficiente. Acerca la cámara y repite la foto.");
  if (spanX / image.width < 0.25 || spanY / image.height < 0.45) throw new Error("La hoja aparece recortada o demasiado lejos. Repite la foto incluyendo sus cuatro esquinas.");
  const radius = Math.max(2, Math.min(spanX, spanY) * profile.bubbleRadius);
  const values = new Map<number, Array<{ option: number; darkness: number }>>();
  for (const bubble of profile.bubbles) {
    if (bubble.questionNo > numQuestions || bubble.optionIndex >= numOptions) continue;
    const center = projectMatrixPoint(markers, bubble.x, bubble.y);
    const inside = sample(image, center.x, center.y, radius * 0.55);
    const background = sampleRing(image, center.x, center.y, radius * 1.25, radius * 1.75);
    const darkness = Math.max(0, (background - inside) / Math.max(55, background));
    const row = values.get(bubble.questionNo) ?? [];
    row.push({ option: bubble.optionIndex, darkness });
    values.set(bubble.questionNo, row);
  }

  const answers: OmrAnswer[] = [];
  for (let q = 1; q <= numQuestions; q += 1) {
    const scores = (values.get(q) ?? []).sort((a, b) => a.option - b.option);
    if (scores.length !== numOptions) throw new Error("La calibración no coincide con las opciones de este examen.");
    const ranked = [...scores].sort((a, b) => b.darkness - a.darkness);
    const first = ranked[0];
    const second = ranked[1];
    const confidence = Math.max(0, Math.min(1, (first.darkness - second.darkness) / Math.max(0.12, first.darkness)));
    if (first.darkness < 0.12) answers.push({ q, detected: null, confidence: Math.min(1, 1 - first.darkness / 0.12), flag: "blank" });
    else if (second.darkness >= 0.12) answers.push({ q, detected: null, confidence, flag: "multiple" });
    else if (first.darkness < 0.24 || confidence < 0.35) answers.push({ q, detected: first.option, confidence, flag: "faint" });
    else answers.push({ q, detected: first.option, confidence, flag: "ok" });
  }
  return { markers, answers };
}
