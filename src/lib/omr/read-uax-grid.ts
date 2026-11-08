import type { GrayImage } from "../matrix/detect";
import { matrixProfileInputSchema, type UaxGridProfile } from "../matrix/profile";
import { detectUaxTables, validateUaxTables, validateUaxReference, type UaxTableGeometry } from "../matrix/uax-grid";
import type { OmrAnswer } from "./read";

export type UaxOmrResult = { tables: UaxTableGeometry[]; answers: OmrAnswer[] };
function decodeReferences(profile: UaxGridProfile): GrayImage[] {
  const { format, version, tables, rowsPerBlock, blocks, optionsPerBlock } = profile;
  // Reuse the persisted contract, allowing server metadata on the outer object.
  // Validate BOTH payloads (including padding bits) before atob/pixel allocation.
  const parsed = matrixProfileInputSchema.safeParse({ format, version, tables, rowsPerBlock, blocks, optionsPerBlock });
  if (!parsed.success || parsed.data.format !== "uax-grid-40") {
    throw new Error("Referencia UAX malformada; vuelve a calibrar con una hoja en blanco.");
  }
  return parsed.data.tables.map(table => {
    const binary = atob(table.reference);
    if (binary.length !== 320 * 880) throw new Error("Longitud de referencia UAX incompatible.");
    const image = { width: 320, height: 880, data: Uint8Array.from(binary, c => c.charCodeAt(0)) };
    validateUaxReference(image, undefined, { ignoreEdgeLines: true });
    return image;
  });
}

function normalize(image: GrayImage): Float32Array {
  const result = new Float32Array(image.data.length);
  for (let row = 0; row < 20; row++) for (let col = 0; col < 5; col++) {
    let background = 0;
    for (let y = row * 44 + 4; y < row * 44 + 40; y++) for (let x = col * 64 + 4; x < col * 64 + 60; x++) {
      background = Math.max(background, image.data[y * 320 + x]);
    }
    if (background < 90) throw new Error("Iluminacion insuficiente; repite la captura sin sombras intensas.");
    for (let y = row * 44; y < (row + 1) * 44; y++) for (let x = col * 64; x < (col + 1) * 64; x++) {
      result[y * 320 + x] = Math.max(0, (background - image.data[y * 320 + x]) / background);
    }
  }
  return result;
}

function align(reference: Float32Array, capture: Float32Array) {
  let best = { dx: 0, dy: 0, loss: Infinity };
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const losses: number[] = [];
    for (let row = 0; row < 20; row++) for (let col = 0; col < 5; col++) {
      const cx = (col + .5) * 64, cy = (row + .5) * 44;
      let mismatch = 0, union = 0;
      for (let y = cy - 11; y <= cy + 11; y++) for (let x = cx - 12; x <= cx + 12; x++) {
        const a = reference[y * 320 + x] > .3;
        const b = capture[(y + dy) * 320 + x + dx] > .3;
        if (a || b) union++;
        if (a !== b) mismatch++;
      }
      losses.push(union ? mismatch / union : 1);
    }
    // Trim annotated cells, not rows or tables. Most printed cells must agree.
    losses.sort((a, b) => a - b);
    const loss = losses.slice(0, 70).reduce((sum, n) => sum + n, 0) / 70;
    if (loss < best.loss) best = { dx, dy, loss };
  }
  const columnLosses = [];
  for (let col = 0; col < 5; col++) {
    const losses = [];
    for (let row = 0; row < 20; row++) {
      let missing = 0, ink = 0;
      const cx = (col + .5) * 64, cy = (row + .5) * 44;
      for (let y = cy - 11; y <= cy + 11; y++) for (let x = cx - 12; x <= cx + 12; x++) {
        const ri = y * 320 + x, ci = (y + best.dy) * 320 + x + best.dx;
        const a = reference[ri] > .3, b = capture[ci] > .3;
        let nearB = false, nearA = false;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          if (capture[ci + oy * 320 + ox] > .25) nearB = true;
          if (col === 0 && reference[ri + oy * 320 + ox] > .25) nearA = true;
        }
        if (a) { ink++; if (!nearB) missing++; }
        // Numbering is not an answer area; compare it in both directions so
        // swapped table contents cannot be hidden by the annotated-cell trim.
        if (col === 0 && b) { ink++; if (!nearA) missing++; }
      }
      const loss = ink ? missing / ink : 1;
      // Added ink may cover every A in a block. Missing printed ink, however,
      // is never evidence of a blank answer: a local glare must fail closed.
      if (loss > .35) throw new Error("La impresion no coincide con la referencia o la alineacion local es mala. Repite la captura.");
      losses.push(loss);
    }
    losses.sort((a, b) => a - b);
    const count = col === 0 ? 20 : 12;
    columnLosses.push(losses.slice(0, count).reduce((sum, n) => sum + n, 0) / count);
  }
  if (Math.max(...columnLosses) > .12 || !Number.isFinite(best.loss)) {
    throw new Error("La referencia y la captura no coinciden o la alineacion es mala. Ajusta las tablas o repite la foto.");
  }
  best.loss = Math.max(...columnLosses);
  return best;
}

function dilate(reference: Float32Array) {
  const result = new Float32Array(reference.length);
  for (let y = 2; y < 878; y++) for (let x = 2; x < 318; x++) {
    let maximum = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) maximum = Math.max(maximum, reference[(y + dy) * 320 + x + dx]);
    result[y * 320 + x] = maximum;
  }
  return result;
}

function gridMask(capture: Float32Array) {
  const mask = new Uint8Array(capture.length);
  for (let y = 0; y < 880; y++) {
    if (Math.min(y % 44, 44 - y % 44) > 5) continue;
    let hits = 0;
    for (let x = 0; x < 320; x++) if (capture[y * 320 + x] > .14) hits++;
    if (hits < 320 * .7) continue;
    for (let py = Math.max(0, y - 1); py <= Math.min(879, y + 1); py++) mask.fill(1, py * 320, (py + 1) * 320);
  }
  for (let x = 0; x < 320; x++) {
    if (Math.min(x % 64, 64 - x % 64) > 5) continue;
    let hits = 0;
    for (let y = 0; y < 880; y++) if (capture[y * 320 + x] > .14) hits++;
    if (hits < 880 * .7) continue;
    for (let px = Math.max(0, x - 1); px <= Math.min(319, x + 1); px++) for (let y = 0; y < 880; y++) mask[y * 320 + px] = 1;
  }
  return mask;
}

/** Experimental heuristic scores, not calibrated probabilities. Never saves a result. */
export function readUaxGrid(image: GrayImage, profile: UaxGridProfile, tables?: UaxTableGeometry[]): UaxOmrResult {
  const references = decodeReferences(profile);
  const located = tables ?? detectUaxTables(image);
  if (!located) throw new Error("No se localizan dos tablas UAX completas; ajusta las esquinas o repite la captura.");
  const captures = validateUaxTables(image, located);
  const answers: OmrAnswer[] = [];
  for (let block = 0; block < 2; block++) {
    const reference = normalize(references[block]), capture = normalize(captures[block]);
    const alignment = align(reference, capture), printed = dilate(reference);
    const borders = gridMask(capture);
    for (let row = 0; row < 20; row++) {
      const scores = [];
      for (let option = 0; option < 4; option++) {
        const cx = (option + 1.5) * 64, cy = (row + .5) * 44;
        let count = 0, strength = 0, minX = 320, maxX = 0, minY = 880, maxY = 0;
        const quadrants = new Set<number>();
        // Keep the circle area; only the actual grid borders are excluded.
        for (let y = cy - 18; y <= cy + 18; y++) for (let x = cx - 27; x <= cx + 27; x++) {
          const ci = (y + alignment.dy) * 320 + x + alignment.dx;
          if (borders[ci]) continue;
          const residual = Math.max(0, capture[ci] - printed[y * 320 + x]);
          if (residual < .16) continue;
          count++; strength += residual;
          minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          quadrants.add((x >= cx ? 1 : 0) + (y >= cy ? 2 : 0));
        }
        const spatial = maxX - minX >= 18 && maxY - minY >= 18 && quadrants.size === 4;
        scores.push({ option, count, strength, clear: spatial && count >= 60 && count < 650 && strength / count > .48 });
      }
      scores.sort((a, b) => b.strength - a.strength);
      const [first, second] = scores;
      const q = block * 20 + row + 1;
      const evidence = first.count >= 18 && first.strength >= 5;
      const margin = (first.strength - second.strength) / Math.max(20, first.strength);
      const confidence = Math.max(0, Math.min(.95, margin * (1 - alignment.loss)));
      if (!evidence) answers.push({ q, detected: null, confidence: Math.max(0, .9 - alignment.loss), flag: "blank" });
      else if (second.count >= 18 && second.strength >= 5) answers.push({ q, detected: null, confidence, flag: "multiple" });
      else if (!first.clear || margin < .5) answers.push({ q, detected: first.option, confidence: Math.min(.49, confidence), flag: "faint" });
      else answers.push({ q, detected: first.option, confidence, flag: "ok" });
    }
  }
  return { tables: located, answers };
}
