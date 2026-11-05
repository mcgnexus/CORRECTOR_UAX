"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { calibrateMatrix, markersFromPoints, type MatrixCalibration, type Point } from "@/lib/matrix/detect";

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
const MARKER_COLOR = "#2a9d8f";
const BUBBLE_COLOR = "#e63946";
const CLICK_COLOR = "#1d3557";

function toGray(data: Uint8ClampedArray) {
  const gray = new Uint8Array(data.length / 4);
  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * 4;
    gray[index] = Math.round(data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114);
  }
  return gray;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

export default function MatrixCalibrator({ examId, numQuestions, numOptions, initialProfile }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bitmapRef = useRef<ImageBitmap | null>(null);
  const sourceRef = useRef<ImageData | null>(null);
  const [rotation, setRotation] = useState(0);
  const [detected, setDetected] = useState<MatrixCalibration | null>(null);
  const [pendingClicks, setPendingClicks] = useState<Point[]>([]);
  const [manualMode, setManualMode] = useState(false);
  const [imageReady, setImageReady] = useState(false);
  const [grid, setGrid] = useState({ offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1, radius: 1 });
  const [saved, setSaved] = useState(Boolean(initialProfile));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");

  const calibration = useMemo(() => {
    if (!detected) return null;
    return {
      ...detected,
      bubbleRadius: detected.bubbleRadius * grid.radius,
      bubbles: detected.bubbles.map((bubble) => ({
        ...bubble,
        x: clamp01(0.5 + (bubble.x - 0.5) * grid.scaleX + grid.offsetX / 100),
        y: clamp01(0.5 + (bubble.y - 0.5) * grid.scaleY + grid.offsetY / 100),
      })),
    };
  }, [detected, grid]);

  function drawOverlay() {
    const canvas = canvasRef.current;
    const source = sourceRef.current;
    if (!canvas || !source) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.putImageData(source, 0, 0);
    const width = canvas.width;
    const height = canvas.height;
    const scale = width / MAX_SIDE;
    context.lineWidth = Math.max(2, width / 500);

    if (calibration) {
      context.strokeStyle = MARKER_COLOR;
      for (const marker of calibration.markers) {
        const size = Math.max(10, marker.size);
        context.strokeRect(marker.x - size / 2, marker.y - size / 2, size, size);
      }
      context.strokeStyle = BUBBLE_COLOR;
      for (const bubble of calibration.bubbles) {
        context.beginPath();
        context.arc(bubble.x * width, bubble.y * height, Math.max(3, calibration.bubbleRadius * width), 0, Math.PI * 2);
        context.stroke();
      }
    }

    if (pendingClicks.length > 0) {
      context.fillStyle = CLICK_COLOR;
      for (const click of pendingClicks) {
        context.beginPath();
        context.arc(click.x, click.y, Math.max(5, scale * 8), 0, Math.PI * 2);
        context.fill();
      }
      context.strokeStyle = CLICK_COLOR;
      context.beginPath();
      pendingClicks.forEach((click, index) => {
        if (index === 0) context.moveTo(click.x, click.y);
        else context.lineTo(click.x, click.y);
      });
      context.stroke();
    }
  }

  useEffect(() => {
    drawOverlay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calibration, pendingClicks]);

  async function render(bitmap: ImageBitmap, angle: number) {
    const canvas = canvasRef.current;
    if (!canvas) throw new Error("No se pudo preparar la vista previa.");
    const swap = angle === 90 || angle === 270;
    const rawWidth = swap ? bitmap.height : bitmap.width;
    const rawHeight = swap ? bitmap.width : bitmap.height;
    const scale = Math.min(1, MAX_SIDE / Math.max(rawWidth, rawHeight));
    const width = Math.round(rawWidth * scale);
    const height = Math.round(rawHeight * scale);
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("No se pudo preparar la vista previa.");
    context.save();
    context.translate(width / 2, height / 2);
    context.rotate((angle * Math.PI) / 180);
    const drawWidth = Math.round(bitmap.width * scale);
    const drawHeight = Math.round(bitmap.height * scale);
    context.drawImage(bitmap, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    context.restore();
    sourceRef.current = context.getImageData(0, 0, width, height);
    setRotation(angle);
  }

  function runDetection(markers?: Point[]) {
    const canvas = canvasRef.current;
    const source = sourceRef.current;
    if (!canvas || !source) return;
    setError("");
    setMensaje("");
    setPendingClicks([]);
    const gray = toGray(source.data);
    const markerSet = markers ? markersFromPoints(markers) : undefined;
    if (markers && !markerSet) {
      setError("Las cuatro esquinas marcadas no forman un área válida. Vuelve a marcarlas.");
      return;
    }
    const result = calibrateMatrix({ width: canvas.width, height: canvas.height, data: gray }, { numQuestions, numOptions }, markerSet);
    if (!result.success) {
      setDetected(null);
      setError(result.error);
      return;
    }
    setDetected(result.calibration);
    setManualMode(false);
    setGrid({ offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1, radius: 1 });
    setSaved(false);
    setMensaje(`Rejilla detectada: ${result.calibration.blocks} bloques × ${result.calibration.rowsPerBlock} filas × ${result.calibration.optionsPerBlock} opciones (${result.calibration.bubbles.length} burbujas). Ajusta el desplazamiento si no coincide con la plantilla.`);
  }

  async function procesar(file?: File) {
    setError("");
    setMensaje("");
    setSaved(false);
    setDetected(null);
    setPendingClicks([]);
    setImageReady(false);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Selecciona una imagen de la matriz (JPG o PNG).");
      return;
    }

    setBusy(true);
    try {
      bitmapRef.current?.close();
      const bitmap = await createImageBitmap(file);
      bitmapRef.current = bitmap;
      setImageReady(true);
      await render(bitmap, 0);
      runDetection();
    } catch {
      setError("No se pudo leer la imagen. Prueba con otra foto de la matriz.");
    } finally {
      setBusy(false);
    }
  }

  async function rotate(delta: number) {
    const bitmap = bitmapRef.current;
    if (!bitmap) return;
    setBusy(true);
    try {
        await render(bitmap, (rotation + delta + 360) % 360);
      runDetection();
    } catch {
      setError("No se pudo rotar la imagen.");
    } finally {
      setBusy(false);
    }
  }

  function startManual() {
    setManualMode(true);
    setDetected(null);
    setPendingClicks([]);
    setMensaje("Haz clic en las cuatro esquinas de las marcas de registro, en cualquier orden.");
    setError("");
  }

  function onCanvasClick(event: React.MouseEvent<HTMLCanvasElement>) {
    if (!manualMode) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
    const next = [...pendingClicks, { x, y }];
    if (next.length < 4) {
      setPendingClicks(next);
      setMensaje(`Marca ${next.length} de 4.`);
      return;
    }
    setPendingClicks(next);
    runDetection(next);
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
      setDetected(null);
      setMensaje("Calibración eliminada.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tarjeta" id="calibracion">
      <h2>Calibración de la matriz</h2>
      <p className="vacio">
        Sube una foto o escaneo de la hoja de respuestas en blanco. Puedes rotarla y marcar manualmente las cuatro
        esquinas si la detección automática falla. La imagen nunca sale de este dispositivo.
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

      <div className="fila-acciones" style={{ marginTop: "0.5rem" }}>
        <button type="button" className="secundario" onClick={() => void rotate(-90)} disabled={busy || !imageReady}>Girar izquierda</button>
        <button type="button" className="secundario" onClick={() => void rotate(90)} disabled={busy || !imageReady}>Girar derecha</button>
        <button type="button" className="secundario" onClick={() => runDetection()} disabled={busy || !imageReady}>Detectar automáticamente</button>
        <button type="button" className="secundario" onClick={startManual} disabled={busy || !imageReady}>Marcar esquinas manualmente</button>
      </div>

      <canvas
        ref={canvasRef}
        className="matriz-lienzo"
        aria-label="Vista previa de la calibración. Haz clic en las cuatro esquinas cuando esté activo el marcado manual."
        onClick={onCanvasClick}
        style={manualMode ? { cursor: "crosshair" } : undefined}
      />

      {calibration ? (
        <fieldset className="matriz-ajustes">
          <legend>Ajuste fino de la rejilla</legend>
          <label htmlFor="grid-offset-x">Desplazamiento horizontal ({grid.offsetX}%)</label>
          <input id="grid-offset-x" type="range" min={-10} max={10} step={0.2} value={grid.offsetX} onChange={(event) => setGrid((current) => ({ ...current, offsetX: Number(event.target.value) }))} />
          <label htmlFor="grid-offset-y">Desplazamiento vertical ({grid.offsetY}%)</label>
          <input id="grid-offset-y" type="range" min={-10} max={10} step={0.2} value={grid.offsetY} onChange={(event) => setGrid((current) => ({ ...current, offsetY: Number(event.target.value) }))} />
          <label htmlFor="grid-scale-x">Escala horizontal ({grid.scaleX.toFixed(2)}×)</label>
          <input id="grid-scale-x" type="range" min={0.7} max={1.3} step={0.01} value={grid.scaleX} onChange={(event) => setGrid((current) => ({ ...current, scaleX: Number(event.target.value) }))} />
          <label htmlFor="grid-scale-y">Escala vertical ({grid.scaleY.toFixed(2)}×)</label>
          <input id="grid-scale-y" type="range" min={0.7} max={1.3} step={0.01} value={grid.scaleY} onChange={(event) => setGrid((current) => ({ ...current, scaleY: Number(event.target.value) }))} />
          <label htmlFor="grid-radius">Radio de burbuja ({grid.radius.toFixed(2)}×)</label>
          <input id="grid-radius" type="range" min={0.5} max={1.8} step={0.05} value={grid.radius} onChange={(event) => setGrid((current) => ({ ...current, radius: Number(event.target.value) }))} />
        </fieldset>
      ) : null}

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
