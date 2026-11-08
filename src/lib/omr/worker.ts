import { readOmr, type OmrProfile } from "./read";
import type { MatrixMarker } from "@/lib/matrix/detect";
import type { MatrixProfileInput } from "@/lib/matrix/profile";
import type { UaxTableGeometry } from "@/lib/matrix/uax-grid";
import { readUaxGrid } from "./read-uax-grid";

type Request = {
  rgba: ArrayBuffer;
  width: number;
  height: number;
  profile: OmrProfile | MatrixProfileInput;
  numQuestions: number;
  numOptions: number;
  markers?: MatrixMarker[];
  tables?: UaxTableGeometry[];
};

self.onmessage = (event: MessageEvent<Request>) => {
  try {
    const { rgba, width, height, profile, numQuestions, numOptions, markers, tables } = event.data;
    self.postMessage({ type: "progress", value: 10 });
    const pixels = new Uint8ClampedArray(rgba);
    const gray = new Uint8Array(width * height);
    for (let i = 0; i < gray.length; i += 1) {
      const offset = i * 4;
      gray[i] = Math.round(pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114);
    }
    self.postMessage({ type: "progress", value: 35 });
    const result = "format" in profile && profile.format === "uax-grid-40"
      ? readUaxGrid({ width, height, data: gray }, profile, tables)
      : readOmr({ width, height, data: gray }, profile as OmrProfile, numQuestions, numOptions, markers);
    self.postMessage({ type: "progress", value: 100 });
    self.postMessage({ type: "result", result });
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : "No se pudo leer la hoja." });
  }
};
