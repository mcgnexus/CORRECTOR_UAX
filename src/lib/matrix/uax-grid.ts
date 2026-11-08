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

function hasGrid(image: GrayImage) {
  let maximum = 0;
  for (const value of image.data) maximum = Math.max(maximum, value);
  if (maximum < 90) return false;
  const threshold = maximum * .72;
  const support = (horizontal: boolean, position: number) => {
    let count = 0, hits = 0;
    const length = horizontal ? 320 : 880;
    for (let i = 5; i < length - 5; i += 3) {
      let dark = false;
      for (let offset = -3; offset <= 3; offset++) {
        const x = horizontal ? i : Math.max(0, Math.min(319, position + offset));
        const y = horizontal ? Math.max(0, Math.min(879, position + offset)) : i;
        if (image.data[y * 320 + x] < threshold) dark = true;
      }
      count++; if (dark) hits++;
    }
    return hits / count;
  };
  for (let row = 0; row <= 20; row++) if (support(true, Math.min(879, row * 44)) < .86) return false;
  for (let col = 0; col <= 5; col++) if (support(false, Math.min(319, col * 64)) < .86) return false;
  // Reject extra horizontal dividers (for example an included header row).
  for (let row = 0; row < 20; row++) if (support(true, row * 44 + 22) > .65) return false;
  return true;
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
    || Math.max(...widths) / Math.min(...widths) > 1.5 || rectified.some(t => !hasGrid(t))) {
    throw new Error("No se valida la estructura de cuadricula 20x5. Ajusta las esquinas o repite la captura.");
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

function referenceIsBlank(image: GrayImage) {
  for (let row = 0; row < 20; row++) for (let col = 1; col < 5; col++) {
    let outside = 0;
    const cx = (col + .5) * 64, cy = (row + .5) * 44;
    let background = 0;
    for (let y = cy - 18; y <= cy + 18; y++) for (let x = cx - 26; x <= cx + 26; x++) {
      background = Math.max(background, image.data[y * 320 + x]);
    }
    for (let y = cy - 18; y <= cy + 18; y++) for (let x = cx - 26; x <= cx + 26; x++) {
      if ((Math.abs(x - cx) > 10 || Math.abs(y - cy) > 11) && image.data[y * 320 + x] < background * .75) outside++;
    }
    if (outside > 28) return false;
  }
  return true;
}

export function validateUaxReference(image: GrayImage) {
  if (!hasGrid(image) || !referenceIsBlank(image)) throw new Error("Referencia incompatible: usa una cuadricula UAX en blanco completa.");
  for (let row = 0; row < 20; row++) for (let col = 0; col < 5; col++) {
    const cx = (col + .5) * 64, cy = (row + .5) * 44;
    let ink = 0, background = 0;
    for (let y = cy - 11; y <= cy + 11; y++) for (let x = cx - 10; x <= cx + 10; x++) background = Math.max(background, image.data[y * 320 + x]);
    for (let y = cy - 11; y <= cy + 11; y++) for (let x = cx - 10; x <= cx + 10; x++) if (image.data[y * 320 + x] < background * .72) ink++;
    if (background < 90 || ink < (col === 0 ? 8 : 15) || ink > 300) throw new Error("Referencia incompatible: faltan letras o numeros impresos legibles en las celdas.");
  }
}

export function calibrateUaxGrid(image: GrayImage, tables: UaxTableGeometry[]): UaxGridProfile {
  const rectified = validateUaxTables(image, tables);
  if (rectified.some(t => !referenceIsBlank(t))) throw new Error("La referencia debe estar en blanco: se detectan trazos sospechosos. Usa otra hoja y confirma la vista previa.");
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
