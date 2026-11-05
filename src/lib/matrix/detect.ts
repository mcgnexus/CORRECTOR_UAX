export type GrayImage = {
  width: number;
  height: number;
  data: Uint8Array;
};

export type Point = { x: number; y: number };

export type MatrixMarker = Point & { size: number };

export type MatrixBubble = {
  questionNo: number;
  optionIndex: number;
  x: number;
  y: number;
};

export type MatrixCalibration = {
  markers: MatrixMarker[];
  bubbles: MatrixBubble[];
  bubbleRadius: number;
  rowsPerBlock: number;
  blocks: number;
  optionsPerBlock: number;
};

export type CalibrationOptions = {
  numQuestions: number;
  numOptions: number;
};

export type CalibrationResult =
  | { success: true; calibration: MatrixCalibration }
  | { success: false; error: string };

type Component = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  area: number;
  sumX: number;
  sumY: number;
};

type Candidate = {
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
  fill: number;
  hole: number;
};

function otsuThreshold(data: Uint8Array): number {
  const histogram = new Uint32Array(256);
  for (let index = 0; index < data.length; index += 1) histogram[data[index]] += 1;
  const total = data.length;
  let sum = 0;
  for (let value = 0; value < 256; value += 1) sum += value * histogram[value];
  let sumBackground = 0;
  let weightBackground = 0;
  let best = 0;
  let bestVariance = -1;
  for (let value = 0; value < 256; value += 1) {
    weightBackground += histogram[value];
    if (weightBackground === 0) continue;
    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;
    sumBackground += value * histogram[value];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const variance = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      best = value;
    }
  }
  return Math.min(254, Math.max(1, best));
}

function binarize(image: GrayImage): Uint8Array {
  const threshold = otsuThreshold(image.data);
  const binary = new Uint8Array(image.width * image.height);
  for (let index = 0; index < binary.length; index += 1) {
    binary[index] = image.data[index] <= threshold ? 1 : 0;
  }
  return binary;
}

function findComponents(image: GrayImage, binary: Uint8Array): Component[] {
  const { width, height } = image;
  const visited = new Uint8Array(binary.length);
  const components: Component[] = [];
  const stack: number[] = [];

  for (let start = 0; start < binary.length; start += 1) {
    if (binary[start] === 0 || visited[start] === 1) continue;
    visited[start] = 1;
    stack.push(start);
    const component: Component = {
      minX: width,
      minY: height,
      maxX: 0,
      maxY: 0,
      area: 0,
      sumX: 0,
      sumY: 0,
    };

    while (stack.length > 0) {
      const index = stack.pop() as number;
      const x = index % width;
      const y = Math.floor(index / width);
      component.area += 1;
      component.sumX += x;
      component.sumY += y;
      if (x < component.minX) component.minX = x;
      if (x > component.maxX) component.maxX = x;
      if (y < component.minY) component.minY = y;
      if (y > component.maxY) component.maxY = y;

      if (x > 0) {
        const next = index - 1;
        if (binary[next] === 1 && visited[next] === 0) {
          visited[next] = 1;
          stack.push(next);
        }
      }
      if (x < width - 1) {
        const next = index + 1;
        if (binary[next] === 1 && visited[next] === 0) {
          visited[next] = 1;
          stack.push(next);
        }
      }
      if (y > 0) {
        const next = index - width;
        if (binary[next] === 1 && visited[next] === 0) {
          visited[next] = 1;
          stack.push(next);
        }
      }
      if (y < height - 1) {
        const next = index + width;
        if (binary[next] === 1 && visited[next] === 0) {
          visited[next] = 1;
          stack.push(next);
        }
      }
    }

    components.push(component);
  }

  return components;
}

function toCandidates(components: Component[], image: GrayImage): Candidate[] {
  return components.map((component) => {
    const width = component.maxX - component.minX + 1;
    const height = component.maxY - component.minY + 1;
    const centerX = Math.round(component.sumX / component.area);
    const centerY = Math.round(component.sumY / component.area);
    const inner = Math.max(1, Math.round(Math.min(width, height) * 0.2));
    let holeSum = 0;
    let holeCount = 0;
    for (let y = centerY - inner; y <= centerY + inner; y += 1) {
      for (let x = centerX - inner; x <= centerX + inner; x += 1) {
        if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
        holeSum += image.data[y * image.width + x];
        holeCount += 1;
      }
    }
    return {
      width,
      height,
      fill: component.area / (width * height),
      area: component.area,
      x: component.sumX / component.area,
      y: component.sumY / component.area,
      hole: holeCount ? holeSum / holeCount : 255,
    };
  });
}

function solveHomography(from: Point[], to: Point[]): number[] {
  const matrix: number[][] = [];
  for (let index = 0; index < 4; index += 1) {
    const { x, y } = from[index];
    const { x: u, y: v } = to[index];
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }

  for (let column = 0; column < 8; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 8; row += 1) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
    }
    [matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];
    const divisor = matrix[column][column];
    if (Math.abs(divisor) < 1e-10) throw new Error("No se pudo calcular la perspectiva.");
    for (let cell = column; cell < 9; cell += 1) matrix[column][cell] /= divisor;
    for (let row = 0; row < 8; row += 1) {
      if (row === column) continue;
      const factor = matrix[row][column];
      for (let cell = column; cell < 9; cell += 1) matrix[row][cell] -= factor * matrix[column][cell];
    }
  }

  return matrix.map((row) => row[8]);
}

function project(homography: number[], x: number, y: number): Point {
  const denominator = homography[6] * x + homography[7] * y + 1;
  return {
    x: (homography[0] * x + homography[1] * y + homography[2]) / denominator,
    y: (homography[3] * x + homography[4] * y + homography[5]) / denominator,
  };
}

export function projectMatrixPoint(markers: MatrixMarker[], x: number, y: number): Point {
  return project(solveHomography(
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
    markers.map(({ x, y }) => ({ x, y })),
  ), x, y);
}

export function markerSpans(markers: MatrixMarker[]) {
  const [tl, tr, bl, br] = markers;
  const spanX = (Math.hypot(tr.x - tl.x, tr.y - tl.y) + Math.hypot(br.x - bl.x, br.y - bl.y)) / 2;
  const spanY = (Math.hypot(bl.x - tl.x, bl.y - tl.y) + Math.hypot(br.x - tr.x, br.y - tr.y)) / 2;
  return { spanX, spanY, min: Math.min(spanX, spanY) };
}

export function bubblePixelRadius(bubbleRadius: number, markers: MatrixMarker[]) {
  return Math.max(2, markerSpans(markers).min * bubbleRadius);
}

function cross(origin: Point, a: Point, b: Point) {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
}

function validateQuad(markers: MatrixMarker[], image: GrayImage): string | null {
  if (markers.length !== 4) return "Se necesitan cuatro marcas.";
  if (markers.some((marker) => marker.x < -image.width * 0.02 || marker.x > image.width * 1.02 || marker.y < -image.height * 0.02 || marker.y > image.height * 1.02)) {
    return "Las marcas deben estar dentro de la imagen.";
  }
  if (markers.some((marker) => !Number.isFinite(marker.x) || !Number.isFinite(marker.y))) return "Las marcas tienen coordenadas no válidas.";
  const summed = markers.map((marker) => marker.x + marker.y);
  const difference = markers.map((marker) => marker.x - marker.y);
  if (markers[0].x + markers[0].y > Math.min(...summed) + 1e-6
    || markers[3].x + markers[3].y < Math.max(...summed) - 1e-6
    || markers[1].x - markers[1].y < Math.max(...difference) - 1e-6
    || markers[2].y - markers[2].x < Math.max(...markers.map((marker) => marker.y - marker.x)) - 1e-6) {
    return "El orden de las marcas debe ser TL, TR, BL y BR.";
  }
  const [tl, tr, br, bl] = [markers[0], markers[1], markers[3], markers[2]];
  const edges: Array<[Point, Point, Point]> = [
    [tl, tr, br],
    [tr, br, bl],
    [br, bl, tl],
    [bl, tl, tr],
  ];
  const orientations = edges.map(([origin, a, b]) => Math.sign(cross(origin, a, b)));
  if (orientations.some((value) => value === 0) || new Set(orientations).size !== 1) {
    return "Las cuatro marcas no forman un cuadrilátero válido.";
  }
  const top = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const bottom = Math.hypot(br.x - bl.x, br.y - bl.y);
  const left = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const right = Math.hypot(br.x - tr.x, br.y - tr.y);
  if (Math.min(top, bottom) < image.width * 0.25 || Math.min(left, right) < image.height * 0.3) {
    return "Las marcas están demasiado juntas para contener la rejilla.";
  }
  return null;
}

function quadCorners<T extends Point>(points: T[]): T[] | undefined {
  const tl = points.reduce((best, current) => (current.x + current.y < best.x + best.y ? current : best));
  const br = points.reduce((best, current) => (current.x + current.y > best.x + best.y ? current : best));
  const tr = points.reduce((best, current) => (current.x - current.y > best.x - best.y ? current : best));
  const bl = points.reduce((best, current) => (current.y - current.x > best.y - best.x ? current : best));
  const distinct = new Set([tl, tr, bl, br].map((point) => `${Math.round(point.x)}:${Math.round(point.y)}`));
  if (distinct.size !== 4) return undefined;
  return [tl, tr, bl, br];
}

function frameEvidence(markers: MatrixMarker[], solid: Candidate[], rings: Candidate[]) {
  let homography: number[];
  try {
    homography = solveHomography(markers.map(({ x, y }) => ({ x, y })), [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]);
  } catch {
    return null;
  }
  const inside = (point: Point, margin = 0) =>
    Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= -margin && point.x <= 1 + margin && point.y >= -margin && point.y <= 1 + margin;
  const markerSize = markers.reduce((sum, marker) => sum + marker.size, 0) / 4;
  let insideRings = 0;
  let outsideRings = 0;
  for (const ring of rings) {
    if (inside(project(homography, ring.x, ring.y))) insideRings += 1;
    else outsideRings += 1;
  }
  let insideSolids = 0;
  for (const candidate of solid) {
    if (markers.some((marker) => Math.hypot(marker.x - candidate.x, marker.y - candidate.y) <= markerSize * 1.5)) continue;
    if (inside(project(homography, candidate.x, candidate.y), -0.01)) insideSolids += 1;
  }
  return { insideRings, outsideRings, insideSolids, evidence: insideRings + insideSolids };
}

function selectMarkers(image: GrayImage, candidates: Candidate[], requireFour: boolean): MatrixMarker[] | undefined {
  const solid = candidates
    .filter((candidate) => candidate.fill >= 0.85)
    .filter((candidate) => {
      const aspect = candidate.width / candidate.height;
      return aspect >= 0.6 && aspect <= 1.6 && candidate.width >= 6 && candidate.height >= 6;
    })
    .sort((a, b) => b.area - a.area)
    .slice(0, 40);
  const rings = candidates.filter((candidate) => {
    const aspect = candidate.width / candidate.height;
    const size = (candidate.width + candidate.height) / 2;
    return candidate.fill <= 0.62 && candidate.hole >= 128 && aspect >= 0.5 && aspect <= 1.8 && size >= 5;
  });

  if (solid.length < (requireFour ? 4 : 3)) return undefined;

  const hypotheses: Array<{ markers: MatrixMarker[]; score: number; area: number }> = [];
  const seen = new Set<string>();
  const evaluate = (points: Candidate[], ambiguous: boolean) => {
    const corners = quadCorners(points);
    if (!corners) return;
    const markers = corners.map((point) => ({ x: point.x, y: point.y, size: (point.width + point.height) / 2 }));
    if (validateQuad(markers, image)) return;
    const key = markers.map((marker) => `${Math.round(marker.x)}:${Math.round(marker.y)}`).sort().join("|");
    if (seen.has(key)) return;
    const evidence = frameEvidence(markers, solid, rings);
    if (!evidence) return;
    if (ambiguous && (evidence.evidence < 3 || evidence.outsideRings > Math.max(2, evidence.insideRings * 0.05))) return;
    seen.add(key);
    const [tl, tr, bl] = markers;
    const area = Math.abs((tr.x - tl.x) * (bl.y - tl.y) - (bl.x - tl.x) * (tr.y - tl.y));
    hypotheses.push({ markers, score: evidence.evidence, area });
  };

  const bases = solid.slice(0, Math.min(12, solid.length));
  for (const base of bases) {
    const baseSize = (base.width + base.height) / 2;
    const similar = solid.filter((candidate) => {
      const size = (candidate.width + candidate.height) / 2;
      return size >= baseSize * 0.75 && size <= baseSize * 1.33;
    });
    if (similar.length < 4) continue;
    if (similar.length === 4) {
      evaluate(similar, false);
      continue;
    }
    const capped = similar.slice(0, 12);
    for (let a = 0; a < capped.length - 3; a += 1) {
      for (let b = a + 1; b < capped.length - 2; b += 1) {
        for (let c = b + 1; c < capped.length - 1; c += 1) {
          for (let d = c + 1; d < capped.length; d += 1) {
            evaluate([capped[a], capped[b], capped[c], capped[d]], true);
          }
        }
      }
    }
  }

  if (hypotheses.length > 0) {
    const bestScore = hypotheses.reduce((max, item) => Math.max(max, item.score), 0);
    const eligible = hypotheses.filter((item) => item.score >= bestScore * 0.6);
    eligible.sort((a, b) => a.area - b.area);
    return eligible[0]?.markers;
  }

  if (!requireFour && solid.length >= 3) {
    if (solid.length === 3) {
      const sorted = [...solid].sort((left, right) => left.x + left.y - (right.x + right.y));
      const [lowest, middle, highest] = sorted;
      const computed = (x: number, y: number) => ({ ...lowest, x, y });
      const possibilities = [
        [computed(lowest.x + middle.x - highest.x, lowest.y + middle.y - highest.y), lowest, middle, highest],
        [lowest, computed(lowest.x + highest.x - middle.x, lowest.y + highest.y - middle.y), middle, highest],
        [lowest, middle, computed(lowest.x + highest.x - middle.x, lowest.y + highest.y - middle.y), highest],
        [lowest, middle, highest, computed(lowest.x + highest.x - middle.x, lowest.y + highest.y - middle.y)],
      ];
      const inferredHypotheses: Array<{ markers: MatrixMarker[]; score: number; area: number }> = [];
      for (const corners of possibilities) {
        const ordered = quadCorners(corners);
        if (!ordered) continue;
        const markers: MatrixMarker[] = ordered.map((corner) => ({
          x: corner.x,
          y: corner.y,
          size: (corner.width + corner.height) / 2,
        }));
        if (validateQuad(markers, image)) continue;
        const evidence = frameEvidence(markers, solid, rings);
        if (!evidence || evidence.evidence < 3) continue;
        const [tl, tr, bl] = markers;
        const area = Math.abs((tr.x - tl.x) * (bl.y - tl.y) - (bl.x - tl.x) * (tr.y - tl.y));
        inferredHypotheses.push({ markers, score: evidence.evidence, area });
      }
      if (inferredHypotheses.length === 0) return undefined;
      const bestScore = inferredHypotheses.reduce((max, item) => Math.max(max, item.score), 0);
      const eligible = inferredHypotheses.filter((item) => item.score >= bestScore * 0.6).sort((a, b) => a.area - b.area);
      return eligible[0]?.markers;
    }
    const inferred = inferRectangleByIds(solid.slice(0, 4), image);
    if (inferred) return inferred;
  }
  return undefined;
}

function inferRectangleByIds(points: Candidate[], image: GrayImage): MatrixMarker[] | undefined {
  interface Hypothesis { tl: Candidate; tr: Candidate; bl: Candidate; br: Candidate; error: number }
  let best: Hypothesis | undefined;
  for (let tlIndex = 0; tlIndex < points.length; tlIndex += 1) {
    for (let trIndex = 0; trIndex < points.length; trIndex += 1) {
      if (trIndex === tlIndex) continue;
      for (let blIndex = 0; blIndex < points.length; blIndex += 1) {
        if (blIndex === tlIndex || blIndex === trIndex) continue;
        for (let brIndex = 0; brIndex < points.length; brIndex += 1) {
          if (brIndex === tlIndex || brIndex === trIndex || brIndex === blIndex) continue;
          const tl = points[tlIndex];
          const tr = points[trIndex];
          const bl = points[blIndex];
          const br = points[brIndex];
          const topBottom = Math.hypot(tr.x - tl.x, tr.y - tl.y) - Math.hypot(br.x - bl.x, br.y - bl.y);
          const leftRight = Math.hypot(bl.x - tl.x, bl.y - tl.y) - Math.hypot(br.x - tr.x, br.y - tr.y);
          const diagonal = Math.hypot(tr.x - bl.x, tr.y - bl.y) - Math.hypot(tl.x - br.x, tl.y - br.y);
          const error = topBottom ** 2 + leftRight ** 2 + diagonal ** 2;
          if (!best || error < best.error) best = { tl, tr, bl, br, error };
        }
      }
    }
  }
  if (!best) return undefined;
  const markers: MatrixMarker[] = [
    { x: best.tl.x, y: best.tl.y, size: (best.tl.width + best.tl.height) / 2 },
    { x: best.tr.x, y: best.tr.y, size: (best.tr.width + best.tr.height) / 2 },
    { x: best.bl.x, y: best.bl.y, size: (best.bl.width + best.bl.height) / 2 },
    { x: best.br.x, y: best.br.y, size: (best.br.width + best.br.height) / 2 },
  ];
  if (validateQuad(markers, image)) return undefined;
  return markers;
}

export function markersFromPoints(points: Point[]): MatrixMarker[] | undefined {
  if (points.length !== 4) return undefined;
  const corners = quadCorners(points);
  if (!corners) return undefined;
  const [tl, tr, bl] = corners;
  const area = Math.abs((tr.x - tl.x) * (bl.y - tl.y) - (bl.x - tl.x) * (tr.y - tl.y));
  if (area < 1000) return undefined;
  const size = Math.max(4, Math.min(Math.hypot(tr.x - tl.x, tr.y - tl.y), Math.hypot(bl.x - tl.x, bl.y - tl.y)) * 0.015);
  return corners.map((point) => ({ x: point.x, y: point.y, size }));
}

export function detectRegistrationMarkers(image: GrayImage): MatrixMarker[] | undefined {
  if (image.width < 300 || image.height < 300 || image.height <= image.width) return undefined;
  const markers = selectMarkers(image, toCandidates(findComponents(image, binarize(image)), image), true);
  if (!markers) return undefined;
  if (validateQuad(markers, image)) return undefined;
  if (markers.some((marker) => marker.x <= 0 || marker.y <= 0 || marker.x >= image.width || marker.y >= image.height)) {
    return undefined;
  }
  return markers;
}

function cluster(values: number[], tolerance: number) {
  const sorted = [...values].sort((a, b) => a - b);
  const clusters: { center: number; count: number }[] = [];
  for (const value of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && value - last.center <= tolerance) {
      last.center = (last.center * last.count + value) / (last.count + 1);
      last.count += 1;
    } else {
      clusters.push({ center: value, count: 1 });
    }
  }
  return clusters;
}

type AxisFit = { centers: number[]; pitch: number; residual: number };

function linearFit(points: { index: number; value: number }[]): AxisFit | null {
  const count = points.length;
  if (count < 2) {
    if (count === 1) return { centers: [points[0].value], pitch: 0, residual: 0 };
    return null;
  }
  const meanIndex = points.reduce((sum, point) => sum + point.index, 0) / count;
  const meanValue = points.reduce((sum, point) => sum + point.value, 0) / count;
  let covariance = 0;
  let variance = 0;
  for (const point of points) {
    covariance += (point.index - meanIndex) * (point.value - meanValue);
    variance += (point.index - meanIndex) ** 2;
  }
  const slope = variance > 0 ? covariance / variance : 0;
  const intercept = meanValue - slope * meanIndex;
  const residual = Math.max(...points.map((point) => Math.abs(point.value - (intercept + slope * point.index))));
  return { centers: points.map((point) => intercept + slope * point.index), pitch: Math.abs(slope), residual };
}

function fitRows(normalized: Point[], expected: number, rowTolerance: number) {
  const rowClusters = cluster(normalized.map((point) => point.y), rowTolerance);
  const maxCount = rowClusters.reduce((max, item) => Math.max(max, item.count), 0);
  const selected = rowClusters
    .filter((item) => item.count >= maxCount * 0.5)
    .sort((a, b) => b.count - a.count)
    .slice(0, expected)
    .sort((a, b) => a.center - b.center);
  if (selected.length < expected) return null;
  const fit = linearFit(selected.map((item, index) => ({ index, value: item.center })));
  if (!fit || (expected > 1 && fit.residual > rowTolerance)) return null;
  return { rows: fit.centers, rowTolerance };
}

export function calibrateMatrix(image: GrayImage, options: CalibrationOptions, manualMarkers?: MatrixMarker[]): CalibrationResult {
  if (image.width < 300 || image.height < 300) {
    return { success: false, error: "La imagen es demasiado pequeña para calibrar." };
  }

  const candidates = toCandidates(findComponents(image, binarize(image)), image);
  const markers = manualMarkers && manualMarkers.length === 4
    ? manualMarkers
    : selectMarkers(image, candidates, false);
  if (!markers) return { success: false, error: "No se encontraron las cuatro marcas de registro. Puedes marcarlas manualmente." };
  const quadProblem = validateQuad(markers, image);
  if (quadProblem) return { success: false, error: quadProblem };

  let toCanonical: number[];
  try {
    toCanonical = solveHomography(
      markers.map(({ x, y }) => ({ x, y })),
      [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
    );
  } catch {
    return { success: false, error: "Las marcas no permiten calcular la perspectiva." };
  }

  const markerSize = markers.reduce((sum, marker) => sum + marker.size, 0) / 4;
  const ringCandidates = candidates.filter((candidate) => {
    const aspect = candidate.width / candidate.height;
    const size = (candidate.width + candidate.height) / 2;
    return (
      candidate.fill <= 0.62 &&
      candidate.hole >= 128 &&
      aspect >= 0.5 &&
      aspect <= 1.8 &&
      size >= Math.max(5, markerSize * 0.3) &&
      size <= markerSize * 1.6
    );
  });

  const normalizedSizes: number[] = [];
  const normalized = ringCandidates.map((candidate) => {
    const point = project(toCanonical, candidate.x, candidate.y);
    if (Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1) {
      normalizedSizes.push((candidate.width + candidate.height) / 4);
    }
    return point;
  }).filter((point) => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1 && Number.isFinite(point.x) && Number.isFinite(point.y));

  const totalColumns = options.numOptions * 2;
  const rowsExpected = Math.ceil(options.numQuestions / 2);
  if (normalized.length < Math.max(totalColumns, 4)) {
    return { success: false, error: "No se detectaron suficientes burbujas dentro de las marcas. Acerca la cámara o usa una imagen más nítida." };
  }

  const radii = ringCandidates.map((candidate) => (candidate.width + candidate.height) / 4).sort((a, b) => a - b);
  const seedRadius = radii[Math.floor(radii.length / 2)] ?? 5;
  const spans = markerSpans(markers);
  const rowTolerance = Math.max(0.004, (seedRadius * 1.1) / spans.spanY);
  const columnTolerance = Math.max(0.003, (seedRadius * 0.7) / spans.spanX);

  const fittedRows = fitRows(normalized, rowsExpected, rowTolerance);
  if (!fittedRows) {
    return { success: false, error: `Se esperaban ${rowsExpected} filas de burbujas alineadas y no se encontraron. Comprueba el número de preguntas del examen.` };
  }
  const rowToleranceFit = fittedRows.rowTolerance;

  const rowColumnGroups: number[][] = Array.from({ length: rowsExpected }, () => []);
  const cellsByRow: Array<Array<{ u: number; size: number }>> = Array.from({ length: rowsExpected }, () => []);
  normalized.forEach((point, pointIndex) => {
    let bestRow = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    fittedRows.rows.forEach((rowCenter, index) => {
      const distance = Math.abs(point.y - rowCenter);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestRow = index;
      }
    });
    if (bestRow < 0 || bestDistance > rowToleranceFit) return;
    cellsByRow[bestRow].push({ u: point.x, size: normalizedSizes[pointIndex] ?? seedRadius });
    rowColumnGroups[bestRow].push(point.x);
  });

  const columnCells = cluster(rowColumnGroups.flat(), columnTolerance);
  const rowSupport = new Map<number, Set<number>>();
  for (let rowIndex = 0; rowIndex < rowsExpected; rowIndex += 1) {
    for (const u of rowColumnGroups[rowIndex]) {
      columnCells.forEach((cell, cellIndex) => {
        if (Math.abs(u - cell.center) <= columnTolerance) {
          const support = rowSupport.get(cellIndex) ?? new Set<number>();
          support.add(rowIndex);
          rowSupport.set(cellIndex, support);
        }
      });
    }
  }
  const requiredSupport = Math.max(1, Math.ceil(rowsExpected * 0.6));
  const columnCandidates = columnCells
    .map((cell, cellIndex) => ({ cell, support: rowSupport.get(cellIndex)?.size ?? 0 }))
    .filter((item) => item.support >= requiredSupport)
    .sort((a, b) => b.support - a.support)
    .slice(0, totalColumns)
    .sort((a, b) => a.cell.center - b.cell.center);
  if (columnCandidates.length < totalColumns) {
    return { success: false, error: "No se pudieron identificar las columnas de opciones con soporte suficiente. Comprueba que la plantilla coincide con el examen." };
  }

  const leftFit = linearFit(columnCandidates.slice(0, options.numOptions).map((item, index) => ({ index, value: item.cell.center })));
  const rightFit = linearFit(columnCandidates.slice(options.numOptions, totalColumns).map((item, index) => ({ index, value: item.cell.center })));
  if (!leftFit || !rightFit || (options.numOptions > 1 && (leftFit.residual > columnTolerance || rightFit.residual > columnTolerance))) {
    return { success: false, error: "Las columnas de opciones no forman dos bloques regulares. Comprueba la plantilla o el encuadre." };
  }
  const leftCenters = options.numOptions === 1 ? [columnCandidates[0].cell.center] : leftFit.centers;
  const rightCenters = rightFit.centers;
  const pitchU = Math.max(leftFit.pitch || 0, rightFit.pitch || 0, (seedRadius * 1.6) / spans.spanX);

  const blocks = [leftCenters, rightCenters];
  const bubbles: MatrixBubble[] = [];

  for (let blockIndex = 0; blockIndex < 2; blockIndex += 1) {
    const blockColumns = blocks[blockIndex];
    for (let rowIndex = 0; rowIndex < rowsExpected; rowIndex += 1) {
      const questionNo = blockIndex * rowsExpected + rowIndex + 1;
      if (questionNo > options.numQuestions) break;
      for (let optionIndex = 0; optionIndex < options.numOptions; optionIndex += 1) {
        const u = blockColumns[optionIndex];
        if (u === undefined) return { success: false, error: "Faltan columnas de opciones en la matriz." };
        const supported = cellsByRow[rowIndex].some((cell) => Math.abs(cell.u - u) <= pitchU * 0.45);
        if (!supported) {
          return { success: false, error: `No se encontró la burbuja de la pregunta ${questionNo}, opción ${optionIndex + 1}. Comprueba el encuadre o la plantilla.` };
        }
        bubbles.push({ questionNo, optionIndex, x: u, y: fittedRows.rows[rowIndex] });
      }
    }
  }

  const supportedSizes = cellsByRow.flat().map((cell) => cell.size).sort((a, b) => a - b);
  const usedRadius = supportedSizes.length > 0
    ? supportedSizes[Math.floor(supportedSizes.length / 2)]
    : seedRadius;
  const bubbleRadius = usedRadius / spans.min;

  return {
    success: true,
    calibration: {
      markers,
      bubbles,
      bubbleRadius,
      rowsPerBlock: rowsExpected,
      blocks: 2,
      optionsPerBlock: options.numOptions,
    },
  };
}

export function bubbleCountForQuestions(calibration: MatrixCalibration, numQuestions: number) {
  return calibration.bubbles.filter((bubble) => bubble.questionNo <= numQuestions).length;
}



export function _debugSelection(image: GrayImage) {
  const candidates = toCandidates(findComponents(image, binarize(image)), image);
  const solid = candidates
    .filter((candidate) => (candidate.fill >= 0.55 && candidate.hole <= 70) || candidate.fill >= 0.85)
    .filter((candidate) => {
      const aspect = candidate.width / candidate.height;
      return aspect >= 0.6 && aspect <= 1.6 && candidate.width >= 6 && candidate.height >= 6;
    })
    .sort((a, b) => b.area - a.area)
    .slice(0, 40);
  const rings = candidates.filter((candidate) => {
    const aspect = candidate.width / candidate.height;
    const size = (candidate.width + candidate.height) / 2;
    return candidate.fill <= 0.62 && candidate.hole >= 128 && aspect >= 0.5 && aspect <= 1.8 && size >= 5;
  });
  const chosen = selectMarkers(image, candidates, false);
  return { solid: solid.map((c) => ({ x: Math.round(c.x), y: Math.round(c.y), w: c.width, h: c.height, fill: Number(c.fill.toFixed(2)), hole: Math.round(c.hole) })), ringCount: rings.length, chosen: chosen?.map((m) => ({ x: Math.round(m.x), y: Math.round(m.y) })) };
}
