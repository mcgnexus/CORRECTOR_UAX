import type { GrayImage, Point } from "./detect";
import type { UaxGridProfile } from "./profile";

export type UaxTableGeometry = { corners: [Point, Point, Point, Point] };
export const UAX_TABLE_WIDTH = 320;
export const UAX_TABLE_HEIGHT = 880;

function validateImage(image: GrayImage) {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1
    || image.data.length !== image.width * image.height) throw new Error("La imagen no tiene un formato valido.");
}

function validateQuad(image: GrayImage, table: UaxTableGeometry) {
  if (table.corners.length !== 4 || table.corners.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)
    || p.x < 0 || p.x >= image.width || p.y < 0 || p.y >= image.height)) {
    throw new Error("Las cuatro esquinas deben estar dentro de la imagen.");
  }
  const points = table.corners;
  for (let i = 0; i < 4; i++) {
    const a = points[i], b = points[(i + 1) % 4], c = points[(i + 2) % 4];
    if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) <= 0) {
      throw new Error("Esquinas degeneradas o cruzadas; usa el orden TL TR BR BL.");
    }
  }
  const [tl, tr, br, bl] = points;
  const width = (Math.hypot(tr.x - tl.x, tr.y - tl.y) + Math.hypot(br.x - bl.x, br.y - bl.y)) / 2;
  const height = (Math.hypot(bl.x - tl.x, bl.y - tl.y) + Math.hypot(br.x - tr.x, br.y - tr.y)) / 2;
  if (tr.x <= tl.x || br.x <= bl.x || bl.y <= tl.y || br.y <= tr.y || width < 150 || height < 400
    || width / height < .22 || width / height > .55) throw new Error("Tabla recortada, pequena o con orientacion incompatible.");
}

function projection(table: UaxTableGeometry) {
  const [a, b, c, d] = table.corners;
  const dx1 = b.x - c.x, dx2 = d.x - c.x, dx3 = a.x - b.x + c.x - d.x;
  const dy1 = b.y - c.y, dy2 = d.y - c.y, dy3 = a.y - b.y + c.y - d.y;
  const det = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(det) < 1e-8) throw new Error("No se puede calcular la perspectiva de la tabla.");
  const g = (dx3 * dy2 - dx2 * dy3) / det;
  const h = (dx1 * dy3 - dx3 * dy1) / det;
  return (x: number, y: number): Point => {
    const den = g * x + h * y + 1;
    return {
      x: ((b.x - a.x + g * b.x) * x + (d.x - a.x + h * d.x) * y + a.x) / den,
      y: ((b.y - a.y + g * b.y) * x + (d.y - a.y + h * d.y) * y + a.y) / den,
    };
  };
}

/** x/y are normalized within the full five-column table, not the photograph. */
export function projectUaxPoint(table: UaxTableGeometry, x: number, y: number): Point {
  return projection(table)(x, y);
}

export function rectifyUaxTable(image: GrayImage, table: UaxTableGeometry): GrayImage {
  validateImage(image);
  validateQuad(image, table);
  const map = projection(table);
  const data = new Uint8Array(UAX_TABLE_WIDTH * UAX_TABLE_HEIGHT);
  for (let y = 0; y < UAX_TABLE_HEIGHT; y++) for (let x = 0; x < UAX_TABLE_WIDTH; x++) {
    const point = map(x / UAX_TABLE_WIDTH, y / UAX_TABLE_HEIGHT);
    const px = Math.min(image.width - 1, Math.max(0, point.x));
    const py = Math.min(image.height - 1, Math.max(0, point.y));
    const ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy;
    const nextX = Math.min(ix + 1, image.width - 1), nextY = Math.min(iy + 1, image.height - 1);
    data[y * UAX_TABLE_WIDTH + x] = Math.round(
      image.data[iy * image.width + ix] * (1 - fx) * (1 - fy)
      + image.data[iy * image.width + nextX] * fx * (1 - fy)
      + image.data[nextY * image.width + ix] * (1 - fx) * fy
      + image.data[nextY * image.width + nextX] * fx * fy);
  }
  return { width: UAX_TABLE_WIDTH, height: UAX_TABLE_HEIGHT, data };
}

type LatticeFailure = { kind: "horizontal" | "vertical" | "divider"; index: number; support: number; offset: number };

type LatticeAnalysis = {
  ok: boolean;
  threshold: number;
  bright: number;
  failures: LatticeFailure[];
  /** Measured phase of each expected line (px), linearly interpolated for cell centers. */
  horizontalOffsets: number[];
  verticalOffsets: number[];
};

/** Contrast judged on the rectified paper itself: midpoint between the ink and
 * paper percentiles, immune to glare inflating the single brightest pixel. */
function paperPercentiles(image: GrayImage) {
  const sample: number[] = [];
  for (let i = 0; i < image.data.length; i += 7) sample.push(image.data[i]);
  sample.sort((a, b) => a - b);
  const at = (p: number) => sample[Math.min(sample.length - 1, Math.max(0, Math.round(p * (sample.length - 1))))];
  const bright = at(.92), dark = at(.05);
  return { bright, threshold: Math.round((bright + dark) / 2) };
}

/** How far an expected line may sit from its canonical position, plus the
 * thickness band around it: tolerance = LINE_SEARCH_PX + LINE_BAND_PX (13 px). */
const LINE_SEARCH_PX = 10;
const LINE_BAND_PX = 3;
/** Grid cells are 44 px tall, so a window up to ±13 px never reaches the neighbor
 * line while still rejecting a divider placed mid-cell (22 px away). */

/** Searches the best phase for each expected line within ±10 px (real photos
 * drift more than the old fixed ±3 px band) and reports every failing line
 * with its support so the operator learns WHICH check failed. */
function analyzeGrid(image: GrayImage): LatticeAnalysis {
  const { bright, threshold } = paperPercentiles(image);
  const clampRow = (y: number) => Math.max(0, Math.min(879, y));
  const clampCol = (x: number) => Math.max(0, Math.min(319, x));
  const probe = (horizontal: boolean, position: number) => {
    let best = 0, bestCenter = -1, bestOffset = 0;
    const length = horizontal ? 320 : 880;
    // The wide band gates line presence; the exact center pixel selects the
    // phase, so a line drifting 2 px still reports its true offset (ties favor 0).
    for (let magnitude = 0; magnitude <= LINE_SEARCH_PX; magnitude++) for (const offset of magnitude === 0 ? [0] : [magnitude, -magnitude]) {
      let hits = 0, center = 0, count = 0;
      for (let i = 5; i < length - 5; i += 3) {
        let dark = false;
        for (let d = -LINE_BAND_PX; d <= LINE_BAND_PX; d++) {
          const x = horizontal ? i : clampCol(position + offset + d);
          const y = horizontal ? clampRow(position + offset + d) : i;
          if (image.data[y * 320 + x] < threshold) { dark = true; break; }
        }
        count++; if (dark) hits++;
        const cx = horizontal ? i : clampCol(position + offset);
        const cy = horizontal ? clampRow(position + offset) : i;
        if (image.data[cy * 320 + cx] < threshold) center++;
      }
      const support = hits / count;
      if (support > best) { best = support; }
      if (center / count > bestCenter) { bestCenter = center / count; bestOffset = offset; }
    }
    return { best, bestOffset };
  };
  const failures: LatticeFailure[] = [];
  const horizontalOffsets: number[] = [];
  const verticalOffsets: number[] = [];
  for (let row = 0; row <= 20; row++) {
    const { best, bestOffset } = probe(true, Math.min(879, row * 44));
    horizontalOffsets.push(bestOffset);
    if (best < .86) failures.push({ kind: "horizontal", index: row, support: best, offset: bestOffset });
  }
  for (let col = 0; col <= 5; col++) {
    const { best, bestOffset } = probe(false, Math.min(319, col * 64));
    verticalOffsets.push(bestOffset);
    if (best < .86) failures.push({ kind: "vertical", index: col, support: best, offset: bestOffset });
  }
  // Reject extra horizontal dividers (for example an included header row).
  // A real divider shares the lattice phase; probing only ±LINE_BAND_PX around
  // the phase-corrected mid-cell keeps the wide line window from grazing the
  // neighboring real line when the grid drifts.
  for (let row = 0; row < 20; row++) {
    const phase = (horizontalOffsets[row] + horizontalOffsets[row + 1]) / 2;
    const { best } = probe(true, Math.min(879, row * 44 + 22 + phase));
    if (best > .65) failures.push({ kind: "divider", index: row, support: best, offset: 0 });
  }
  return { ok: failures.length === 0, threshold, bright, failures, horizontalOffsets, verticalOffsets };
}

function hasGrid(image: GrayImage) {
  return analyzeGrid(image).ok;
}

/** Interpolates the measured phase so cell centers follow the same drift as the lattice. */
function phaseAt(lattice: LatticeAnalysis, horizontal: boolean, cell: number) {
  const offsets = horizontal ? lattice.verticalOffsets : lattice.horizontalOffsets;
  return offsets[cell] + (offsets[cell + 1] - offsets[cell]) * .5;
}

/** Validates real grid structure for BOTH automatic and manual localization. */
export function validateUaxTables(image: GrayImage, tables: UaxTableGeometry[]): GrayImage[] {
  validateImage(image);
  if (tables.length !== 2) throw new Error("Se necesitan las dos tablas completas de 20 filas.");
  const centers = tables.map(t => projectUaxPoint(t, .5, .5));
  const rectified = tables.map(t => rectifyUaxTable(image, t));
  const widths = tables.map(t => Math.hypot(t.corners[1].x - t.corners[0].x, t.corners[1].y - t.corners[0].y));
  if (centers[1].x - centers[0].x < (widths[0] + widths[1]) * .45
    || Math.max(...tables[0].corners.map(p => p.x)) >= Math.min(...tables[1].corners.map(p => p.x))) {
    throw new Error("Las tablas deben estar separadas y en orden izquierda/derecha.");
  }
  if (Math.abs(centers[0].y - centers[1].y) > Math.max(...widths) * .5
    || Math.max(...widths) / Math.min(...widths) > 1.5) {
    throw new Error("No se valida la estructura de cuadrícula 20x5: las tablas deben estar a la misma altura y con tamaño parecido. Ajusta las esquinas o repite la captura.");
  }
  const worse = rectified.findIndex(t => !hasGrid(t));
  if (worse >= 0) {
    const analysis = analyzeGrid(rectified[worse]);
    const worst = analysis.failures.sort((a, b) => a.support - b.support).slice(0, 3)
      .map(f => `${f.kind === "horizontal" ? "línea horizontal" : f.kind === "vertical" ? "línea vertical" : "división dentro de la fila"} ${f.index} con soporte ${Math.round(f.support * 100)}% (fase ${f.offset >= 0 ? "+" : ""}${f.offset})`)
      .join("; ");
    throw new Error(`No se valida la estructura de cuadrícula 20x5 de la tabla ${worse === 0 ? "izquierda (1-20)" : "derecha (21-40)"}: ${analysis.failures.length ? worst : "papel apenas legible"}. Se exige tinta en el 86% de cada línea, buscando hasta ${LINE_SEARCH_PX + LINE_BAND_PX} píxeles de desfase. Ajusta las esquinas o repite la captura.`);
  }
  return rectified;
}

export function detectUaxTables(image: GrayImage): UaxTableGeometry[] | null {
  validateImage(image);
  // Connected grid lines propose quadrilaterals; the full rectified lattice is
  // checked afterwards. Disconnected, obscured or ambiguous grids fail closed.
  const visited = new Uint8Array(image.data.length);
  const stack: number[] = [];
  const candidates: UaxTableGeometry[] = [];
  for (let start = 0; start < image.data.length; start++) {
    if (visited[start] || image.data[start] > 155) continue;
    visited[start] = 1; stack.push(start);
    let count = 0;
    let tl = { x: image.width, y: image.height }, tr = { x: 0, y: image.height };
    let br = { x: 0, y: 0 }, bl = { x: image.width, y: 0 };
    while (stack.length) {
      const index = stack.pop()!;
      const x = index % image.width, y = Math.floor(index / image.width);
      count++;
      if (x + y < tl.x + tl.y) tl = { x, y };
      if (x - y > tr.x - tr.y) tr = { x, y };
      if (x + y > br.x + br.y) br = { x, y };
      if (y - x > bl.y - bl.x) bl = { x, y };
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, next = ny * image.width + nx;
        if (nx < 0 || nx >= image.width || ny < 0 || ny >= image.height || visited[next] || image.data[next] > 155) continue;
        visited[next] = 1; stack.push(next);
      }
    }
    if (count < 3000) continue;
    const table: UaxTableGeometry = { corners: [tl, tr, br, bl] };
    try {
      const rectified = rectifyUaxTable(image, table);
      if (hasGrid(rectified)) candidates.push(table);
    } catch { /* A component is only a proposal, never a validated table. */ }
    if (candidates.length > 2) return null;
  }
  if (candidates.length !== 2) return null;
  candidates.sort((a, b) => projectUaxPoint(a, .5, .5).x - projectUaxPoint(b, .5, .5).x);
  try { validateUaxTables(image, candidates); return candidates; } catch { return null; }
}

function referenceIsBlank(image: GrayImage, lattice: LatticeAnalysis) {
  for (let row = 0; row < 20; row++) for (let col = 1; col < 5; col++) {
    let outside = 0;
    const cx = (col + .5) * 64 + phaseAt(lattice, true, col);
    const cy = (row + .5) * 44 + phaseAt(lattice, false, row);
    let background = 0;
    for (let y = cy - 18; y <= cy + 18; y++) for (let x = cx - 26; x <= cx + 26; x++) {
      background = Math.max(background, image.data[Math.round(y) * 320 + Math.round(x)]);
    }
    for (let y = cy - 18; y <= cy + 18; y++) for (let x = cx - 26; x <= cx + 26; x++) {
      if ((Math.abs(x - cx) > 10 || Math.abs(y - cy) > 11) && image.data[Math.round(y) * 320 + Math.round(x)] < background * .75) outside++;
    }
    if (outside > 28) return false;
  }
  return true;
}

export function validateUaxReference(image: GrayImage) {
  const lattice = analyzeGrid(image);
  if (!lattice.ok || !referenceIsBlank(image, lattice)) throw new Error("Referencia incompatible: usa una cuadricula UAX en blanco completa.");
  for (let row = 0; row < 20; row++) for (let col = 0; col < 5; col++) {
    const cx = (col + .5) * 64 + phaseAt(lattice, true, col);
    const cy = (row + .5) * 44 + phaseAt(lattice, false, row);
    let ink = 0;
    for (let y = cy - 11; y <= cy + 11; y++) for (let x = cx - 10; x <= cx + 10; x++) if (image.data[Math.round(y) * 320 + Math.round(x)] < lattice.threshold) ink++;
    if (lattice.bright < 90 || ink < (col === 0 ? 8 : 15) || ink > 300) throw new Error("Referencia incompatible: faltan letras o numeros impresos legibles en las celdas.");
  }
}

export function calibrateUaxGrid(image: GrayImage, tables: UaxTableGeometry[]): UaxGridProfile {
  const rectified = validateUaxTables(image, tables);
  const lattices = rectified.map(analyzeGrid);
  if (lattices.some((lattice, i) => !referenceIsBlank(rectified[i], lattice))) throw new Error("La referencia debe estar en blanco: se detectan trazos sospechosos. Usa otra hoja y confirma la vista previa.");
  rectified.forEach(validateUaxReference);
  const references = tables.map((table, index) => {
    let binary = "";
    for (const value of rectified[index].data) binary += String.fromCharCode(value);
    return {
      corners: table.corners.map(p => ({ x: p.x / image.width, y: p.y / image.height })) as UaxTableGeometry["corners"],
      reference: btoa(binary),
    };
  });
  return { format: "uax-grid-40", version: 1, tables: [references[0], references[1]], rowsPerBlock: 20, blocks: 2, optionsPerBlock: 4 };
}
