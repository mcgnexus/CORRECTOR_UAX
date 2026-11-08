"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { GrayImage, Point } from "@/lib/matrix/detect";
import type { UaxGridProfile } from "@/lib/matrix/profile";
import { calibrateUaxGrid, detectUaxTables, locateUaxTablesByTaps, projectUaxPoint, type UaxTableGeometry } from "@/lib/matrix/uax-grid";

type Profile = UaxGridProfile & { updatedAt: string };
type Props = {
  examId: string;
  initialProfile: Profile | null;
  onProfileChange: (profile: Profile | null) => void;
};
type Preview = { examId: string; pixels: ImageData; gray: GrayImage };
const MAX_SIDE = 2000;
const MAX_BYTES = 20 * 1024 * 1024;
const CORNERS = ["superior izquierda", "superior derecha", "inferior derecha", "inferior izquierda"];

function pointLabel(index: number) {
  return `Tabla ${index < 4 ? "izquierda (1-20)" : "derecha (21-40)"}, ${CORNERS[index % 4]}`;
}

function tablesFromPoints(points: Point[]): UaxTableGeometry[] {
  if (points.length !== 8) return [];
  return [0, 4].map(offset => ({ corners: [points[offset], points[offset + 1], points[offset + 2], points[offset + 3]] }));
}

function prepareImage(bitmap: ImageBitmap, angle: number, examId: string): Preview {
  const swap = angle === 90 || angle === 270;
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round((swap ? bitmap.height : bitmap.width) * scale));
  canvas.height = Math.max(1, Math.round((swap ? bitmap.width : bitmap.height) * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("No se pudo preparar la imagen en este navegador.");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(angle * Math.PI / 180);
  context.drawImage(bitmap, -bitmap.width * scale / 2, -bitmap.height * scale / 2, bitmap.width * scale, bitmap.height * scale);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.round(pixels.data[i * 4] * 0.299 + pixels.data[i * 4 + 1] * 0.587 + pixels.data[i * 4 + 2] * 0.114);
  }
  return { examId, pixels, gray: { width: canvas.width, height: canvas.height, data } };
}

function ReferencePreview({ reference, label }: { reference: string; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = ref.current?.getContext("2d");
    if (!context) return;
    const bytes = atob(reference);
    const pixels = context.createImageData(320, 880);
    for (let i = 0; i < 320 * 880; i++) {
      pixels.data[i * 4] = pixels.data[i * 4 + 1] = pixels.data[i * 4 + 2] = bytes.charCodeAt(i);
      pixels.data[i * 4 + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
  }, [reference]);
  return <figure style={{ margin: 0, flex: "1 1 140px", maxWidth: 320 }}><figcaption>{label}</figcaption><canvas ref={ref} width={320} height={880} aria-label={label} style={{ width: "100%", height: "auto" }} /></figure>;
}

export default function UaxGridCalibrator(props: Props) {
  return <UaxGridCalibratorSession key={props.examId} {...props} />;
}

function UaxGridCalibratorSession({ examId, initialProfile, onProfileChange }: Props) {
  const id = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bitmapRef = useRef<ImageBitmap | null>(null);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const requestRef = useRef<AbortController | null>(null);
  const [image, setImage] = useState<Preview | null>(null);
  const [rotation, setRotation] = useState(0);
  const [points, setPoints] = useState<Point[]>([]);
  const [selected, setSelected] = useState(0);
  const [manual, setManual] = useState(false);
  const [tapMode, setTapMode] = useState<"left" | "right" | null>(null);
  const [taps, setTaps] = useState<Point[]>([]);
  const [draft, setDraft] = useState<UaxGridProfile | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const ready = image?.examId === examId;
  const selectedPoint = points[selected];

  useEffect(() => () => {
    generation.current++;
    requestRef.current?.abort();
    bitmapRef.current?.close();
    bitmapRef.current = null;
    inFlight.current = false;
  }, [examId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    if (!image || image.examId !== examId) { context.clearRect(0, 0, canvas.width, canvas.height); return; }
    canvas.width = image.gray.width;
    canvas.height = image.gray.height;
    context.putImageData(image.pixels, 0, 0);
    context.lineWidth = Math.max(1, canvas.width / 700);
    const tables = tablesFromPoints(points);
    for (let block = 0; block < tables.length; block++) {
      const table = tables[block];
      context.strokeStyle = block === 0 ? "#006d77" : "#9b2226";
      try {
        for (let col = 0; col <= 5; col++) {
          const a = projectUaxPoint(table, col / 5, 0), b = projectUaxPoint(table, col / 5, 1);
          context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
        }
        for (let row = 0; row <= 20; row++) {
          const a = projectUaxPoint(table, 0, row / 20), b = projectUaxPoint(table, 1, row / 20);
          context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
        }
        const cellHeight = Math.hypot(table.corners[3].x - table.corners[0].x, table.corners[3].y - table.corners[0].y) / 20;
        context.font = `bold ${Math.max(8, Math.min(24, cellHeight * .45))}px sans-serif`;
        context.textAlign = "center"; context.textBaseline = "middle";
        for (let row = 0; row < 20; row++) {
          for (let col = 0; col < 5; col++) {
            const p = projectUaxPoint(table, (col + .5) / 5, (row + .5) / 20);
            const label = col === 0 ? String(block * 20 + row + 1) : String.fromCharCode(64 + col);
            context.strokeStyle = "white"; context.lineWidth = 3;
            context.strokeText(label, p.x, p.y); context.fillStyle = block === 0 ? "#006d77" : "#9b2226";
            context.fillText(label, p.x, p.y); context.lineWidth = Math.max(1, canvas.width / 700);
          }
        }
      } catch { /* Una esquina en edición puede ser degenerada; la validación impide guardarla. */ }
    }
    points.forEach((point, index) => {
      context.beginPath(); context.arc(point.x, point.y, Math.max(5, canvas.width / 180), 0, Math.PI * 2);
      context.fillStyle = index === selected ? "#ffb703" : "#1d3557"; context.fill();
      context.strokeStyle = "white"; context.lineWidth = 2; context.stroke();
    });
  }, [image, points, selected, examId]);

  function invalidate() { setDraft(null); setConfirmed(false); setError(""); setMessage(""); }

  function validate(preview: Preview, next: Point[]) {
    invalidate();
    if (next.length !== 8) { setError("Marca las ocho esquinas antes de validar."); return; }
    try {
      setDraft(calibrateUaxGrid(preview.gray, tablesFromPoints(next)));
      setMessage("Tablas preparadas: izquierda 1-20 y derecha 21-40, opciones A-D. Revisa la superposición y los recortes antes de confirmar.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudieron validar las tablas. Ajusta las esquinas o usa otra imagen.");
    }
  }

  function detect(preview: Preview) {
    invalidate(); setPoints([]); setSelected(0);
    try {
      const tables = detectUaxTables(preview.gray);
      if (!tables || tables.length !== 2) {
        setTapMode("left");
        setMessage("No se localizaron ambas tablas automáticamente. Toca el centro de la tabla izquierda (1-20) y después el de la derecha (21-40); también puedes marcar ocho esquinas.");
        return;
      }
      const next = tables.flatMap(table => table.corners);
      setPoints(next); setManual(false); validate(preview, next);
    } catch (cause) {
      setTapMode("left");
      setError(cause instanceof Error ? cause.message : "Falló la detección. Toca el centro de cada tabla o marca las ocho esquinas.");
    }
  }

  function handleTap(point: Point) {
    const next = [...taps, point];
    if (tapMode === "left") {
      setTaps(next);
      setTapMode("right");
      setMessage("Tabla izquierda marcada. Toca el centro de la tabla derecha (21-40).");
      return;
    }
    setTaps([]);
    setTapMode(null);
    setBusy(true);
    setTimeout(() => {
      try {
        const found = locateUaxTablesByTaps(image!.gray, [next[0], next[1]]);
        if (!found) throw new Error("No se pudo ajustar la retícula desde los toques. Comprueba que cada toque cayó dentro de su tabla e inténtalo de nuevo, o marca las ocho esquinas.");
        setPoints(found.flatMap(table => table.corners));
        setSelected(0);
        validate(image!, found.flatMap(table => table.corners));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Falló el ajuste desde los toques.");
      } finally {
        setBusy(false);
      }
    }, 30);
  }

  async function load(file?: File) {
    if (!file || inFlight.current) return;
    setError(""); setMessage("");
    if (!["image/jpeg", "image/png"].includes(file.type)) { setError("Selecciona una imagen JPG o PNG."); return; }
    if (file.size > MAX_BYTES) { setError("La imagen supera el límite de 20 MB."); return; }
    inFlight.current = true; setBusy(true);
    const token = ++generation.current;
    let pendingBitmap: ImageBitmap | null = null;
    try {
      const bitmap = await createImageBitmap(file);
      pendingBitmap = bitmap;
      if (token !== generation.current) { bitmap.close(); return; }
      const preview = prepareImage(bitmap, 0, examId);
      bitmapRef.current?.close(); bitmapRef.current = bitmap;
      pendingBitmap = null;
      setImage(preview); setRotation(0); detect(preview);
    } catch {
      pendingBitmap?.close();
      if (token === generation.current) setError("No se pudo leer la imagen. Prueba otra foto JPG o PNG.");
    } finally {
      if (token === generation.current) { inFlight.current = false; setBusy(false); }
    }
  }

  function rotate(delta: number) {
    if (!bitmapRef.current || !ready || inFlight.current) return;
    try {
      const angle = (rotation + delta + 360) % 360;
      const preview = prepareImage(bitmapRef.current, angle, examId);
      setImage(preview); setRotation(angle); detect(preview);
    } catch { setError("No se pudo girar la imagen. Prueba otra foto."); }
  }

  function changePoint(index: number, point: Point) {
    if (!ready || !image || inFlight.current || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    invalidate();
    const bounded = { x: Math.max(0, Math.min(image.gray.width - 1, point.x)), y: Math.max(0, Math.min(image.gray.height - 1, point.y)) };
    setPoints(current => index === current.length ? [...current, bounded] : current.map((p, i) => i === index ? bounded : p));
    setSelected(index);
  }

  function cancel() {
    if (inFlight.current) return;
    bitmapRef.current?.close(); bitmapRef.current = null;
    setImage(null); setPoints([]); setDraft(null); setConfirmed(false); setManual(false); setError("");
    setMessage("Cambios descartados. Se conserva la calibración guardada anterior.");
  }

  async function persist(remove: boolean) {
    if (inFlight.current || (!remove && (!draft || !confirmed || !ready))) return;
    if (remove && !window.confirm("¿Eliminar la calibración guardada de este examen?")) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    const token = ++generation.current;
    const controller = new AbortController(); requestRef.current = controller;
    let written = false;
    try {
      const url = `/api/exams/${encodeURIComponent(examId)}/matrix`;
      const response = await fetch(url, {
        method: remove ? "DELETE" : "PUT", signal: controller.signal,
        ...(!remove ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) } : {}),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string; problems?: string[] };
        throw new Error([data.error || "No se pudo actualizar la calibración.", ...(data.problems ?? [])].join(" "));
      }
      written = true;
      let saved: Profile | null = null;
      if (!remove) {
        // PUT responde solo status; el timestamp debe proceder del perfil persistido, no del reloj local.
        const read = await fetch(url, { cache: "no-store", signal: controller.signal });
        if (!read.ok) throw new Error("No se pudo recuperar la calibración guardada.");
        const data = await read.json() as { profile?: Profile | null };
        if (!data.profile || data.profile.format !== "uax-grid-40" || !data.profile.updatedAt || !Number.isFinite(Date.parse(data.profile.updatedAt))) {
          throw new Error("El servidor no devolvió un perfil UAX con fecha válida.");
        }
        saved = data.profile;
      }
      if (token !== generation.current) return;
      onProfileChange(saved);
      setDraft(null); setConfirmed(false);
      setMessage(remove ? "Calibración eliminada." : "Calibración guardada. Solo se enviaron las dos referencias recortadas y su geometría, no la foto completa.");
    } catch (cause) {
      if (token === generation.current) {
        if (written && !remove) onProfileChange(null);
        setError(`${written && !remove ? "El servidor aceptó el guardado, pero no se pudo recuperar el perfil. La lectura deshabilitada hasta recargar o reintentar. " : ""}${cause instanceof Error ? cause.message : "No se pudo conectar con el servidor."}`);
      }
    } finally {
      if (token === generation.current) { inFlight.current = false; setBusy(false); requestRef.current = null; }
    }
  }

  return (
    <section className="tarjeta" id="calibracion" aria-busy={busy}>
      <h2>Calibración UAX</h2>
      <p className="aviso">Experimental: falta validar con ejemplos reales anonimizados. No se ha acreditado la precisión con fotos reales.</p>
      <p>Usa una hoja en blanco de dos tablas de 20 filas y opciones A-D. La foto se procesa localmente, a un máximo de 2000 píxeles por lado. Solo se guardan recortes de las tablas y geometría, sin cabecera, nombres ni DNI.</p>
      <p role="status">Estado: {initialProfile ? `calibración guardada (${new Date(initialProfile.updatedAt).toLocaleString("es-ES")})` : "sin calibración guardada"}. {ready ? "Referencia local abierta para revisión." : ""}</p>
      <label htmlFor={`${id}-file`}>Referencia en blanco (JPG o PNG)</label>
      <input id={`${id}-file`} type="file" accept="image/jpeg,image/png" disabled={busy} style={{ maxWidth: "100%" }} onChange={event => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void load(file);
      }} />
      <div className="fila-acciones" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
        <button type="button" className="secundario" disabled={busy || !ready} onClick={() => rotate(-90)}>Girar izquierda</button>
        <button type="button" className="secundario" disabled={busy || !ready} onClick={() => rotate(90)}>Girar derecha</button>
        <button type="button" className="secundario" disabled={busy || !ready} onClick={() => image && detect(image)}>Detectar automáticamente</button>
        <button type="button" className="secundario" disabled={busy || !ready} onClick={() => { invalidate(); setManual(false); setPoints([]); setTaps([]); setTapMode("left"); setMessage("Toca el centro de la tabla izquierda (1-20)."); }}>Dos toques por tabla</button>
        <button type="button" className="secundario" disabled={busy || !ready} onClick={() => { invalidate(); setManual(true); setPoints([]); setSelected(0); setTapMode(null); }}>Marcar ocho esquinas</button>
      </div>
      {tapMode ? <p role="status">Modo dos toques: toca el centro de la tabla {tapMode === "left" ? "izquierda (1-20)" : "derecha (21-40)"}; el ajuste fino es automático.</p> : null}
      <p id={`${id}-instructions`}>Orden: superior izquierda, superior derecha, inferior derecha, inferior izquierda (TL, TR, BR, BL). Primero tabla izquierda 1-20 y después derecha 21-40. Incluye la columna de números. Toca la imagen para añadir o mover la esquina seleccionada; también puedes usar los controles numéricos o las flechas del teclado (Mayús: 10 píxeles).</p>
      {ready && manual && points.length < 8 ? <p role="status">Siguiente punto {points.length + 1}/8: {pointLabel(points.length)}.</p> : null}
      <canvas ref={canvasRef} className="matriz-lienzo" aria-label="Vista previa UAX" aria-describedby={`${id}-instructions`} tabIndex={ready ? 0 : -1}
        style={{ display: ready ? "block" : "none", maxWidth: "100%", height: "auto", cursor: ready ? "crosshair" : undefined }}
        onClick={event => {
          if (!ready || busy) return;
          const rect = event.currentTarget.getBoundingClientRect();
          if (!rect.width || !rect.height) return;
          const point = { x: (event.clientX - rect.left) * event.currentTarget.width / rect.width, y: (event.clientY - rect.top) * event.currentTarget.height / rect.height };
          if (tapMode) { invalidate(); handleTap(point); return; }
          changePoint(manual && points.length < 8 ? points.length : selected, point);
        }}
        onKeyDown={event => {
          if (!selectedPoint || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
          event.preventDefault(); const step = event.shiftKey ? 10 : 1;
          changePoint(selected, { x: selectedPoint.x + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0), y: selectedPoint.y + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0) });
        }} />
      {ready && image ? <fieldset className="matriz-ajustes" disabled={busy} style={{ minWidth: 0 }}>
        <legend>Ajustar esquinas ({points.length}/8)</legend>
        {manual && points.length < 8 ? <button type="button" className="secundario" onClick={() => {
          const index = points.length, corner = index % 4, left = index < 4 ? .08 : .58;
          changePoint(index, { x: image.gray.width * (left + (corner === 1 || corner === 2 ? .34 : 0)), y: image.gray.height * (corner < 2 ? .1 : .9) });
        }}>Añadir esquina con teclado</button> : null}
        <label htmlFor={`${id}-point`}>Esquina seleccionada</label>
        <select id={`${id}-point`} value={selected} disabled={!points.length} style={{ maxWidth: "100%" }} onChange={event => setSelected(Number(event.target.value))}>
          {points.map((_, index) => <option key={index} value={index}>{index + 1}. {pointLabel(index)}</option>)}
        </select>
        {selectedPoint ? <>
          <label htmlFor={`${id}-x`}>Coordenada X (píxeles)</label>
          <input id={`${id}-x`} type="number" min={0} max={image.gray.width - 1} step={1} value={Math.round(selectedPoint.x * 100) / 100} onChange={event => { if (event.currentTarget.value !== "") changePoint(selected, { ...selectedPoint, x: event.currentTarget.valueAsNumber }); }} />
          <label htmlFor={`${id}-y`}>Coordenada Y (píxeles)</label>
          <input id={`${id}-y`} type="number" min={0} max={image.gray.height - 1} step={1} value={Math.round(selectedPoint.y * 100) / 100} onChange={event => { if (event.currentTarget.value !== "") changePoint(selected, { ...selectedPoint, y: event.currentTarget.valueAsNumber }); }} />
        </> : null}
        <button type="button" className="secundario" disabled={points.length !== 8} onClick={() => validate(image, points)}>Validar tablas y referencia</button>
      </fieldset> : null}
      {draft && ready ? <>
        <h3>Referencias que se guardarán</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
          {draft.tables.map((table, index) => <ReferencePreview key={index} reference={table.reference} label={`Tabla ${index === 0 ? "izquierda: 1-20" : "derecha: 21-40"}, A-D`} />)}
        </div>
        <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /> Confirmo que ambas tablas están en blanco, sin respuestas manuscritas ni datos personales, y que números y opciones coinciden con la superposición.</label>
        <p>No se garantiza detectar todas las anotaciones. Si la referencia contiene marcas, usa otra hoja en blanco.</p>
      </> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      <div className="fila-acciones" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
        <button type="button" disabled={busy || !ready || !draft || !confirmed} onClick={() => void persist(false)}>Guardar calibración</button>
        <button type="button" className="secundario" disabled={busy || !ready} onClick={cancel}>Cancelar cambios</button>
        {initialProfile ? <button type="button" className="peligro" disabled={busy} onClick={() => void persist(true)}>Eliminar calibración</button> : null}
      </div>
    </section>
  );
}
