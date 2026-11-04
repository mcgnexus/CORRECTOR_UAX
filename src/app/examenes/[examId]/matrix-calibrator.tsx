"use client";

import { useRef, useState } from "react";
import { calibrateMatrix, type MatrixCalibration } from "@/lib/matrix/detect";

type Profile = {
  bubbles: MatrixCalibration["bubbles"];
  bubbleRadius: number;
  rowsPerBlock: number;
  blocks: number;
  optionsPerBlock: number;
  updatedAt: string;
};

type Props = {
  examId: string;
  numQuestions: number;
  numOptions: number;
  initialProfile: Profile | null;
};

const MAX_SIDE = 1600;

export default function MatrixCalibrator({ examId, numQuestions, numOptions, initialProfile }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [calibration, setCalibration] = useState<MatrixCalibration | null>(null);
  const [saved, setSaved] = useState(Boolean(initialProfile));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");

  async function procesar(file?: File) {
    setError("");
    setMensaje("");
    setSaved(false);
    setCalibration(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Selecciona una imagen de la matriz (JPG o PNG).");
      return;
    }

    setBusy(true);
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
      const width = Math.round(bitmap.width * scale);
      const height = Math.round(bitmap.height * scale);
      const canvas = canvasRef.current;
      if (!canvas) throw new Error("No se pudo preparar la vista previa.");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("No se pudo preparar la vista previa.");
      context.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();

      const pixels = context.getImageData(0, 0, width, height);
      const gray = new Uint8Array(width * height);
      for (let index = 0; index < gray.length; index += 1) {
        const offset = index * 4;
        gray[index] = Math.round(
          pixels.data[offset] * 0.299 + pixels.data[offset + 1] * 0.587 + pixels.data[offset + 2] * 0.114,
        );
      }

      const result = calibrateMatrix({ width, height, data: gray }, { numQuestions, numOptions });
      if (!result.success) {
        setError(result.error);
        return;
      }

      const { calibration: detected } = result;
      setCalibration(detected);

      context.lineWidth = Math.max(2, width / 500);
      context.strokeStyle = "#2a9d8f";
      for (const marker of detected.markers) {
        const size = marker.size;
        context.strokeRect(marker.x - size / 2, marker.y - size / 2, size, size);
      }
      context.strokeStyle = "#e63946";
      for (const bubble of detected.bubbles) {
        context.beginPath();
        context.arc(bubble.x * width, bubble.y * height, detected.bubbleRadius * width, 0, Math.PI * 2);
        context.stroke();
      }

      setMensaje(`Rejilla detectada: ${detected.blocks} bloques × ${detected.rowsPerBlock} filas × ${detected.optionsPerBlock} opciones (${detected.bubbles.length} burbujas).`);
    } catch {
      setError("No se pudo leer la imagen. Prueba con otra foto de la matriz.");
    } finally {
      setBusy(false);
    }
  }

  async function guardar() {
    if (!calibration) return;
    setError("");
    setMensaje("");
    setBusy(true);
    try {
      const response = await fetch(`/api/exams/${examId}/matrix`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bubbles: calibration.bubbles,
          bubbleRadius: calibration.bubbleRadius,
          rowsPerBlock: calibration.rowsPerBlock,
          blocks: calibration.blocks,
          optionsPerBlock: calibration.optionsPerBlock,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; problems?: string[] };
      if (!response.ok) {
        setError([data.error, ...(data.problems ?? [])].filter(Boolean).join(" "));
        return;
      }
      setSaved(true);
      setMensaje("Calibración guardada para este examen. La imagen no se ha subido.");
    } catch {
      setError("No se pudo guardar la calibración. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  async function borrar() {
    if (!window.confirm("¿Eliminar la calibración guardada de este examen?")) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/exams/${examId}/matrix`, { method: "DELETE" });
      if (!response.ok) {
        setError("No se pudo eliminar la calibración.");
        return;
      }
      setSaved(false);
      setCalibration(null);
      setMensaje("Calibración eliminada.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tarjeta" id="calibracion">
      <h2>Calibración de la matriz</h2>
      <p className="vacio">
        Sube una foto o escaneo de la hoja de respuestas en blanco. La app detecta las cuatro marcas y
        la rejilla de burbujas, y guarda solo las coordenadas. La imagen nunca sale de este dispositivo.
      </p>
      <p className="vacio">
        Estado: {saved ? "calibrada" : "sin calibrar"}
        {initialProfile ? ` · actualizada el ${new Date(initialProfile.updatedAt).toLocaleString("es-ES")}` : ""}
      </p>

      <label htmlFor="matrix-image">Imagen de la matriz</label>
      <input
        id="matrix-image"
        type="file"
        accept="image/*"
        disabled={busy}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          void procesar(file);
        }}
      />

      <canvas ref={canvasRef} className="matriz-lienzo" aria-label="Vista previa de la calibración" />

      {error ? <p className="error" role="alert">{error}</p> : null}
      {mensaje ? <p className={calibration ? "ok" : "vacio"} role="status">{mensaje}</p> : null}

      <div className="fila-acciones" style={{ marginTop: "0.75rem" }}>
        <button type="button" onClick={() => void guardar()} disabled={busy || !calibration}>
          {busy ? "Guardando…" : "Guardar calibración"}
        </button>
        {saved ? (
          <button type="button" className="peligro" onClick={() => void borrar()} disabled={busy}>
            Eliminar calibración
          </button>
        ) : null}
      </div>
    </div>
  );
}
