import fs from "node:fs";
import path from "node:path";
import jpeg from "jpeg-js";
import { calibrateMatrix, type GrayImage } from "../src/lib/matrix/detect";

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Uso: npx tsx scripts/verify-calibration.ts <ruta-de-imagen>");
    process.exit(1);
  }
  const fullPath = path.resolve(file);
  if (!fs.existsSync(fullPath)) {
    console.error(`No existe la imagen: ${fullPath}`);
    process.exit(1);
  }

  const decoded = jpeg.decode(fs.readFileSync(fullPath), { useTArray: true });
  const gray = new Uint8Array(decoded.width * decoded.height);
  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * 4;
    gray[index] = Math.round(
      decoded.data[offset] * 0.299 + decoded.data[offset + 1] * 0.587 + decoded.data[offset + 2] * 0.114,
    );
  }

  const image: GrayImage = { width: decoded.width, height: decoded.height, data: gray };
  const result = calibrateMatrix(image, { numQuestions: 50, numOptions: 4 });
  if (!result.success) {
    console.error("Fallo:", result.error);
    process.exit(2);
  }

  const { calibration } = result;
  const questions = new Set(calibration.bubbles.map((bubble) => bubble.questionNo));
  console.log(`Imagen: ${decoded.width}x${decoded.height}`);
  console.log(`Marcas: ${calibration.markers.length}`, calibration.markers.map((m) => `(${Math.round(m.x)},${Math.round(m.y)})`).join(" "));
  console.log(`Bloques: ${calibration.blocks}, filas/bloque: ${calibration.rowsPerBlock}, opciones/bloque: ${calibration.optionsPerBlock}`);
  console.log(`Preguntas: ${questions.size}, burbujas: ${calibration.bubbles.length}, radio: ${calibration.bubbleRadius.toFixed(4)}`);
  console.log(`Primera: q1 opción0 (${calibration.bubbles[0].x.toFixed(3)}, ${calibration.bubbles[0].y.toFixed(3)})`);
  const last = calibration.bubbles[calibration.bubbles.length - 1];
  console.log(`Última: q${last.questionNo} opción${last.optionIndex} (${last.x.toFixed(3)}, ${last.y.toFixed(3)})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
