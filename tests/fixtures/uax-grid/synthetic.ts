import type { GrayImage, Point } from "../../../src/lib/matrix/detect";

type Quad = { corners: [Point, Point, Point, Point] };
export type Mark = { q: number; option: number; kind: "cross" | "circle" | "scratch"; gray?: number };
export type SyntheticOptions = {
  marks?: Mark[];
  missing?: number;
  rows?: number;
  transform?: [number, number, number, number, number, number, number, number];
  shade?: boolean;
  printGray?: number;
  alternateLetters?: boolean;
};

const glyphs = [
  ["01110", "11011", "11011", "11111", "11011", "11011", "11011"],
  ["11110", "11011", "11011", "11110", "11011", "11011", "11110"],
  ["01111", "11000", "11000", "11000", "11000", "11000", "01111"],
  ["11110", "11011", "11011", "11011", "11011", "11011", "11110"],
];
const digits = [
  ["111", "101", "101", "101", "111"], ["010", "110", "010", "010", "111"],
  ["111", "001", "111", "100", "111"], ["111", "001", "111", "001", "111"],
  ["101", "101", "111", "001", "001"], ["111", "100", "111", "001", "111"],
  ["111", "100", "111", "101", "111"], ["111", "001", "010", "010", "010"],
  ["111", "101", "111", "101", "111"], ["111", "101", "111", "001", "111"],
];

// Deliberately independent of the production projection and rectification.
export function syntheticUax(options: SyntheticOptions = {}): { image: GrayImage; tables: [Quad, Quad] } {
  const image = { width: 1000, height: 1250, data: new Uint8Array(1000 * 1250).fill(255) };
  const t = options.transform ?? [1, 0, 0, 0, 1, 0, 0, 0];
  const map = (x: number, y: number): Point => {
    const d = t[6] * x + t[7] * y + 1;
    return { x: (t[0] * x + t[1] * y + t[2]) / d, y: (t[3] * x + t[4] * y + t[5]) / d };
  };
  const dot = (x: number, y: number, gray: number, radius: number) => {
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const px = Math.round(x) + dx, py = Math.round(y) + dy;
      if (px >= 0 && px < image.width && py >= 0 && py < image.height) {
        image.data[py * image.width + px] = Math.min(gray, image.data[py * image.width + px]);
      }
    }
  };
  const line = (x1: number, y1: number, x2: number, y2: number, gray = options.printGray ?? 35, radius = 1) => {
    const a = map(x1, y1), b = map(x2, y2);
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2);
    for (let i = 0; i <= steps; i++) dot(a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps, gray, radius);
  };
  // A misleading identity/header rectangle, never part of the saved reference.
  line(70, 35, 830, 35); line(830, 35, 830, 130); line(830, 130, 70, 130); line(70, 130, 70, 35);
  const tables = [70, 510].map((left, block) => {
    const corners = [map(left, 230), map(left + 320, 230), map(left + 320, 1110), map(left, 1110)] as Quad["corners"];
    if (options.missing === block) return { corners };
    const rows = options.rows ?? 20;
    for (let col = 0; col <= 5; col++) line(left + col * 64, 230, left + col * 64, 1110);
    for (let row = 0; row <= rows; row++) line(left, 230 + row * 880 / rows, left + 320, 230 + row * 880 / rows);
    for (let row = 0; row < rows; row++) {
      const cy = 230 + (row + .5) * 880 / rows;
      const number = String(block * 20 + row + 1);
      [...number].forEach((digit, index) => digits[Number(digit)].forEach((bits, gy) => [...bits].forEach((bit, gx) => {
        if (bit === "1") line(left + 32 - number.length * 4 + index * 8 + gx * 2, cy - 5 + gy * 2,
          left + 33 - number.length * 4 + index * 8 + gx * 2, cy - 4 + gy * 2, options.printGray ?? 35, 0);
      })));
      for (let option = 0; option < 4; option++) {
        const cx = left + (option + 1.5) * 64;
        const glyph = glyphs[(option + (options.alternateLetters ? 2 : 0)) % 4];
        glyph.forEach((bits, gy) => [...bits].forEach((bit, gx) => {
          if (bit === "1") line(cx - 5 + gx * 2, cy - 7 + gy * 2, cx - 4 + gx * 2, cy - 6 + gy * 2, options.printGray ?? 35, 0);
        }));
      }
    }
    for (const mark of options.marks ?? []) {
      if (Math.floor((mark.q - 1) / 20) !== block) continue;
      const cx = left + (mark.option + 1.5) * 64;
      const cy = 230 + ((mark.q - 1) % 20 + .5) * 44;
      const gray = mark.gray ?? 20;
      if (mark.kind === "circle") {
        for (let i = 0; i < 100; i++) line(cx + 17 * Math.cos(i * Math.PI / 50), cy + 16 * Math.sin(i * Math.PI / 50), cx + 17 * Math.cos((i + 1) * Math.PI / 50), cy + 16 * Math.sin((i + 1) * Math.PI / 50), gray);
      } else {
        line(cx - 16, cy - 15, cx + 16, cy + 15, gray);
        line(cx - 16, cy + 15, cx + 16, cy - 15, gray);
        if (mark.kind === "scratch") for (let i = -12; i <= 12; i += 4) line(cx - 22, cy + i, cx + 22, cy - i, gray);
      }
    }
    return { corners };
  }) as [Quad, Quad];
  if (options.shade) for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const index = y * image.width + x;
    image.data[index] = Math.round(image.data[index] * (.68 + .32 * x / image.width));
  }
  return { image, tables };
}
