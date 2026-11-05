import { readOmr, type OmrProfile } from "./read";
import type { MatrixMarker } from "@/lib/matrix/detect";

type Request = {
  rgba: ArrayBuffer;
  width: number;
  height: number;
  profile: OmrProfile;
  numQuestions: number;
  numOptions: number;
  markers?: MatrixMarker[];
};

self.onmessage = (event: MessageEvent<Request>) => {
  try {
    const { rgba, width, height, profile, numQuestions, numOptions, markers } = event.data;
    self.postMessage({ type: "progress", value: 10 });
    const pixels = new Uint8ClampedArray(rgba);
    const gray = new Uint8Array(width * height);
    for (let i = 0; i < gray.length; i += 1) {
      const offset = i * 4;
      gray[i] = Math.round(pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114);
    }
    self.postMessage({ type: "progress", value: 35 });
    const result = readOmr({ width, height, data: gray }, profile, numQuestions, numOptions, markers);
    self.postMessage({ type: "progress", value: 100 });
    self.postMessage({ type: "result", result });
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : "No se pudo leer la hoja." });
  }
};
