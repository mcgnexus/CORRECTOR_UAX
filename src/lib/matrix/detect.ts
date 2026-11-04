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
};

const DARK_THRESHOLD = 128;

function binarize(image: GrayImage): Uint8Array {
  const binary = new Uint8Array(image.width * image.height);
  for (let index = 0; index < binary.length; index += 1) {
    binary[index] = image.data[index] < DARK_THRESHOLD ? 1 : 0;
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

function toCandidates(components: Component[]): Candidate[] {
  return components.map((component) => {
    const width = component.maxX - component.minX + 1;
    const height = component.maxY - component.minY + 1;
    return {
      width,
      height,
      fill: component.area / (width * height),
      area: component.area,
      x: component.sumX / component.area,
      y: component.sumY / component.area,
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

function inferRectangle(points: Candidate[], image: GrayImage): Candidate[] | undefined {
  const corners = ["tl", "tr", "bl", "br"] as const;
  type Corner = (typeof corners)[number];
  const permutations = <T,>(values: T[]): T[][] => {
    if (values.length <= 1) return [values];
    return values.flatMap((value, index) =>
      permutations([...values.slice(0, index), ...values.slice(index + 1)]).map((rest) => [value, ...rest]),
    );
  };

  let bestSet: Record<Corner, Candidate> | undefined;
  let bestError = Number.POSITIVE_INFINITY;

  for (const missing of corners) {
    const present = corners.filter((corner) => corner !== missing);
    for (const assignment of permutations(points)) {
      const set: Partial<Record<Corner, Candidate>> = {};
      present.forEach((corner, index) => {
        set[corner] = assignment[index];
      });
      const tl = set.tl;
      const tr = set.tr;
      const bl = set.bl;
      const br = set.br;
      let inferred: Candidate;
      if (!tl) inferred = { ...br!, x: tr!.x + bl!.x - br!.x, y: tr!.y + bl!.y - br!.y };
      else if (!tr) inferred = { ...tl, x: tl.x + br!.x - bl!.x, y: tl.y + br!.y - bl!.y };
      else if (!bl) inferred = { ...tl, x: tl.x + br!.x - tr!.x, y: tl.y + br!.y - tr!.y };
      else inferred = { ...tr!, x: tl!.x + bl!.x - tr!.x, y: tl!.y + bl!.y - tr!.y };
      set[missing] = inferred;

      const final = set as Record<Corner, Candidate>;
      const error =
        Math.abs(final.tl.y - final.tr.y) +
        Math.abs(final.bl.y - final.br.y) +
        Math.abs(final.tl.x - final.bl.x) +
        Math.abs(final.tr.x - final.br.x);
      const width = (final.tr.x - final.tl.x + final.br.x - final.bl.x) / 2;
      const height = (final.bl.y - final.tl.y + final.br.y - final.tr.y) / 2;
      if (width < image.width * 0.2 || height < image.height * 0.2) continue;
      if (error < bestError) {
        bestError = error;
        bestSet = final;
      }
    }
  }

  return bestSet ? [bestSet.tl, bestSet.tr, bestSet.bl, bestSet.br] : undefined;
}

function selectMarkers(image: GrayImage, components: Component[], requireFour = false): MatrixMarker[] | undefined {
  const imageArea = image.width * image.height;
  const candidates = toCandidates(components)
    .filter((candidate) => {
      const aspect = candidate.width / candidate.height;
      const relativeArea = candidate.area / imageArea;
      return (
        aspect >= 0.75 &&
        aspect <= 1.33 &&
        candidate.fill >= 0.85 &&
        relativeArea >= 0.00002 &&
        relativeArea <= 0.004 &&
        candidate.width >= 6 &&
        candidate.height >= 6
      );
    })
    .sort((a, b) => b.area - a.area)
    .slice(0, 40);

  if (candidates.length < (requireFour ? 4 : 3)) return undefined;

  const reference = candidates[0];
  const similar = candidates.filter((candidate) => {
    const areaRatio = candidate.area / reference.area;
    const widthRatio = candidate.width / reference.width;
    const heightRatio = candidate.height / reference.height;
    return areaRatio >= 0.5 && widthRatio >= 0.6 && widthRatio <= 1.6 && heightRatio >= 0.6 && heightRatio <= 1.6;
  });
  if (requireFour && similar.length < 4) return undefined;
  if (similar.length < 3) return undefined;

  const four = similar.length === 3 ? inferRectangle(similar, image) : undefined;
  const ordered = four ?? (() => {
    const points = similar.slice(0, 4);
    const tl = points.reduce((best, current) => (current.x + current.y < best.x + best.y ? current : best));
    const br = points.reduce((best, current) => (current.x + current.y > best.x + best.y ? current : best));
    const tr = points.reduce((best, current) => (current.x - current.y > best.x - best.y ? current : best));
    const bl = points.reduce((best, current) => (current.y - current.x > best.y - best.x ? current : best));
    return [tl, tr, bl, br];
  })();

  if (!ordered) return undefined;
  const distinct = new Set(ordered.map((marker) => `${Math.round(marker.x)}:${Math.round(marker.y)}`));
  if (distinct.size !== 4) return undefined;

  const [tl, tr, bl] = ordered;
  const quadArea = Math.abs((tr.x - tl.x) * (bl.y - tl.y) - (bl.x - tl.x) * (tr.y - tl.y));
  if (quadArea / imageArea < 0.05) return undefined;

  return ordered.map((marker) => ({
    x: marker.x,
    y: marker.y,
    size: Math.max(marker.width, marker.height),
  }));
}

export function detectRegistrationMarkers(image: GrayImage): MatrixMarker[] | undefined {
  if (image.width < 300 || image.height < 300 || image.height <= image.width) return undefined;
  const markers = selectMarkers(image, findComponents(image, binarize(image)), true);
  if (!markers || markers.some((marker) => marker.x <= 0 || marker.y <= 0 || marker.x >= image.width || marker.y >= image.height)) {
    return undefined;
  }
  const [tl, tr, bl, br] = markers;
  const top = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const bottom = Math.hypot(br.x - bl.x, br.y - bl.y);
  const left = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const right = Math.hypot(br.x - tr.x, br.y - tr.y);
  if (Math.min(top, bottom) < image.width * 0.15 || Math.min(left, right) < image.height * 0.15) return undefined;
  return markers;
}

export function projectMatrixPoint(markers: MatrixMarker[], x: number, y: number): Point {
  return project(solveHomography(
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
    markers.map(({ x, y }) => ({ x, y })),
  ), x, y);
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

export function calibrateMatrix(image: GrayImage, options: CalibrationOptions): CalibrationResult {
  if (image.width < 300 || image.height < 300) {
    return { success: false, error: "La imagen es demasiado pequeña para calibrar." };
  }

  const components = findComponents(image, binarize(image));
  const markers = selectMarkers(image, components);
  if (!markers) return { success: false, error: "No se encontraron las cuatro marcas de registro." };

  const markerSize = markers.reduce((sum, marker) => sum + marker.size, 0) / 4;
  const minBubble = markerSize * 1.0;
  const maxBubble = markerSize * 1.9;

  const bubbleCandidates = toCandidates(components).filter((candidate) => {
    const aspect = candidate.width / candidate.height;
    const size = (candidate.width + candidate.height) / 2;
    if (size < minBubble || size > maxBubble) return false;
    if (aspect < 0.65 || aspect > 1.5) return false;
    return !markers.some((marker) => Math.hypot(marker.x - candidate.x, marker.y - candidate.y) < markerSize);
  });

  if (bubbleCandidates.length < options.numQuestions) {
    return { success: false, error: "No se detectaron suficientes burbujas. Acerca la cámara o usa una imagen más nítida." };
  }

  const tolerance = markerSize * 0.55;
  const columnClusters = cluster(bubbleCandidates.map((candidate) => candidate.x), tolerance)
    .filter((item) => item.count >= 3)
    .sort((a, b) => a.center - b.center);
  const rowClusters = cluster(bubbleCandidates.map((candidate) => candidate.y), tolerance)
    .filter((item) => item.count >= 4)
    .sort((a, b) => a.center - b.center);

  if (columnClusters.length < options.numOptions * 2 || rowClusters.length < 5) {
    return { success: false, error: "No se pudo reconstruir la rejilla de respuestas." };
  }

  const expectedBlocks = Math.max(1, Math.round(columnClusters.length / options.numOptions));
  if (expectedBlocks !== 2) {
    return { success: false, error: "La matriz debe tener dos bloques de preguntas." };
  }

  const mid = columnClusters.length / 2;
  const leftColumns = columnClusters.slice(0, mid);
  const rightColumns = columnClusters.slice(mid);

  const rowsExpected = Math.ceil(options.numQuestions / 2);
  if (rowClusters.length < rowsExpected) {
    return { success: false, error: `Se esperaban ${rowsExpected} filas y se detectaron ${rowClusters.length}.` };
  }

  const rows = rowClusters.slice(0, rowsExpected);
  const homography = solveHomography(
    markers.map(({ x, y }) => ({ x, y })),
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ],
  );

  const blocks = [leftColumns, rightColumns];
  const bubbles: MatrixBubble[] = [];

  for (let blockIndex = 0; blockIndex < 2; blockIndex += 1) {
    const columns = blocks[blockIndex];
    for (let rowIndex = 0; rowIndex < rowsExpected; rowIndex += 1) {
      const questionNo = blockIndex * rowsExpected + rowIndex + 1;
      if (questionNo > options.numQuestions) break;
      for (let optionIndex = 0; optionIndex < options.numOptions; optionIndex += 1) {
        const column = columns[optionIndex];
        if (!column) return { success: false, error: "Faltan columnas de opciones en la matriz." };
        const normalized = project(homography, column.center, rows[rowIndex].center);
        bubbles.push({ questionNo, optionIndex, x: normalized.x, y: normalized.y });
      }
    }
  }

  const xPitchCanonical = Math.abs(
    project(homography, leftColumns[0].center, rows[0].center).x -
      project(homography, leftColumns[1].center, rows[0].center).x,
  );
  const yPitchCanonical = Math.abs(
    project(homography, leftColumns[0].center, rows[0].center).y -
      project(homography, leftColumns[0].center, rows[1].center).y,
  );
  const bubbleRadius = Math.min(xPitchCanonical, yPitchCanonical) * 0.3;

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
