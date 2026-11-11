"use client";

import { useEffect, useId, useRef, useState, type PointerEvent } from "react";

type Props = { canvas: HTMLCanvasElement; busy: boolean; provider?: "DeepSeek" | "Gemini"; onSubmit: (images: [string, string]) => void; onCancel: () => void };
type Rect = { x: number; y: number; width: number; height: number };
type Fields = { x: string; y: string; width: string; height: string };
const empty = (): Fields => ({ x: "", y: "", width: "", height: "" });
const labels = ["Tabla izquierda (1-20)", "Tabla derecha (21-40)"] as const;
const maxBytes = 2 * 1024 * 1024;

function valid(r: Rect, canvas: HTMLCanvasElement) {
  return Object.values(r).every(Number.isInteger) && r.x >= 0 && r.y >= 0 && r.width > 0 && r.height > 0 && r.x + r.width <= canvas.width && r.y + r.height <= canvas.height;
}

export default function UaxVisionCrop(props: Props) {
  const [source, setSource] = useState(props.canvas);
  const [version, setVersion] = useState(0);
  if (source !== props.canvas) {
    setSource(props.canvas);
    setVersion(version + 1);
  }
  return <CropSession key={version} {...props} />;
}

function CropSession({ canvas, busy, provider = "DeepSeek", onSubmit, onCancel }: Props) {
  const id = useId();
  const display = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; index: number } | null>(null);
  const [active, setActive] = useState(0);
  const [rects, setRects] = useState<[Rect | null, Rect | null]>([null, null]);
  const [fields, setFields] = useState<[Fields, Fields]>([empty(), empty()]);
  const [preview, setPreview] = useState<[string, string] | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const ctx = display.current?.getContext("2d");
    if (ctx) ctx.drawImage(canvas, 0, 0);
  }, [canvas]);

  function invalidate() { setPreview(null); setConfirmed(false); setError(""); }
  function update(index: number, rect: Rect) {
    setRects(old => { const next: [Rect | null, Rect | null] = [...old]; next[index] = rect; return next; });
    setFields(old => { const next: [Fields, Fields] = [...old]; next[index] = { x: String(rect.x), y: String(rect.y), width: String(rect.width), height: String(rect.height) }; return next; });
    invalidate();
  }
  function point(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: Math.round(Math.max(0, Math.min(canvas.width, (event.clientX - bounds.left) * canvas.width / bounds.width))), y: Math.round(Math.max(0, Math.min(canvas.height, (event.clientY - bounds.top) * canvas.height / bounds.height))) };
  }
  function prepare() {
    setConfirmed(false); setPreview(null);
    const [left, right] = rects;
    if (!left || !right || !valid(left, canvas) || !valid(right, canvas)) { setError("Selecciona las dos tablas con rectángulos válidos dentro de la imagen."); return; }
    if (left.x + left.width > right.x) { setError("La tabla 1-20 debe quedar a la izquierda de la tabla 21-40, sin solaparse."); return; }
    try {
      const images = [left, right].map(rect => {
        const out = document.createElement("canvas");
        const scale = Math.min(1, 2000 / Math.max(rect.width, rect.height));
        out.width = Math.max(1, Math.round(rect.width * scale)); out.height = Math.max(1, Math.round(rect.height * scale));
        const ctx = out.getContext("2d");
        if (!ctx) throw new Error("No se pudieron crear los recortes en este navegador.");
        ctx.fillStyle = "white"; ctx.fillRect(0, 0, out.width, out.height);
        ctx.drawImage(canvas, rect.x, rect.y, rect.width, rect.height, 0, 0, out.width, out.height);
        return out.toDataURL("image/jpeg", 0.8);
      }) as [string, string];
      if (images.some(image => !image.startsWith("data:image/jpeg;base64,"))) throw new Error("El navegador no pudo generar imágenes JPEG.");
      const size = images.reduce((sum, image) => { const data = image.split(",")[1]; return sum + data.length * 3 / 4 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0); }, 0);
      if (size > maxBytes) throw new Error("Los recortes superan 2 MiB. Selecciona áreas más pequeñas y vuelve a intentarlo.");
      setError(""); setPreview(images);
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudieron preparar los recortes."); }
  }

  return <section aria-label={`Recorte manual para ${provider}`} style={{ display: "grid", gap: 16, maxWidth: 900 }}>
    <div><h3>Selecciona las dos tablas</h3><p>Elige cada tabla y arrastra sobre la imagen, o introduce sus coordenadas en píxeles. No incluyas la cabecera ni datos personales.</p></div>
    <div role="group" aria-label="Tabla a seleccionar" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {labels.map((label, i) => <button type="button" key={label} disabled={busy} aria-pressed={active === i} onClick={() => setActive(i)}>{label}</button>)}
    </div>
    <div style={{ position: "relative", width: "100%", touchAction: "none", cursor: "crosshair", lineHeight: 0 }}
      onPointerDown={event => { if (busy || event.button !== 0) return; const p = point(event); drag.current = { ...p, index: active }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerUp={event => { if (!drag.current || busy) return; const p = point(event); const start = drag.current; drag.current = null; const rect = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), width: Math.abs(start.x - p.x), height: Math.abs(start.y - p.y) }; if (valid(rect, canvas)) update(start.index, rect); else setError("Arrastra para seleccionar un área con ancho y alto."); }}
      onPointerCancel={() => { drag.current = null; }}>
      <canvas ref={display} width={canvas.width} height={canvas.height} aria-label="Imagen original para seleccionar las tablas" style={{ width: "100%", height: "auto" }} />
      {rects.map((rect, i) => rect && <div key={labels[i]} aria-hidden="true" style={{ position: "absolute", pointerEvents: "none", left: `${rect.x / canvas.width * 100}%`, top: `${rect.y / canvas.height * 100}%`, width: `${rect.width / canvas.width * 100}%`, height: `${rect.height / canvas.height * 100}%`, border: `3px solid ${i === 0 ? "#005fcc" : "#b42318"}`, boxSizing: "border-box" }} />)}
    </div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
      {labels.map((label, i) => <fieldset key={label} disabled={busy} style={{ flex: "1 1 260px", minWidth: 0 }}><legend>{label}</legend>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
          {([ ["x", "X"], ["y", "Y"], ["width", "Ancho"], ["height", "Alto"] ] as const).map(([key, name]) => <label key={key} htmlFor={`${id}-${i}-${key}`}>{name}<input id={`${id}-${i}-${key}`} type="number" inputMode="numeric" min="0" step="1" value={fields[i][key]} style={{ display: "block", width: "100%" }} onChange={event => { const value = event.target.value; setFields(old => { const next: [Fields, Fields] = [...old]; next[i] = { ...next[i], [key]: value }; return next; }); setRects(old => { const next: [Rect | null, Rect | null] = [...old]; next[i] = null; return next; }); invalidate(); }} /></label>)}
        </div><button type="button" onClick={() => { const f = fields[i]; const rect = { x: Number(f.x), y: Number(f.y), width: Number(f.width), height: Number(f.height) }; if (Object.values(f).some(v => v.trim() === "") || !valid(rect, canvas)) { setError(`Introduce coordenadas enteras válidas para ${label}.`); return; } update(i, rect); }}>Aplicar coordenadas</button>
      </fieldset>)}
    </div>
    <button type="button" disabled={busy} onClick={prepare}>Preparar vista previa</button>
    {error && <p role="alert">{error}</p>}
    {preview && <div><h4>Vista previa exacta de lo que se enviará</h4><div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>{preview.map ( (image, i) => <figure key={labels[i]} style={{ margin: 0, flex: "1 1 200px", minWidth: 0 }}><figcaption>{labels[i]}</figcaption>{/* Local data URLs must not pass through an image optimization service. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image} alt={`Recorte ${labels[i]}`} style={{ display: "block", maxWidth: "100%", maxHeight: 400, objectFit: "contain" }} /></figure>)}</div>
      <p>La información dentro de los recortes no está anonimizada. Se enviará al proveedor {provider} y su procesamiento puede generar costes. Comprueba que no aparecen la cabecera, el DNI u otros datos personales.</p>
      <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /> He revisado ambos recortes y consiento su envío a {provider}.</label>
    </div>}
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}><button type="button" disabled={busy || !preview || !confirmed} onClick={() => { if (!preview || !confirmed || busy) return; setConfirmed(false); onSubmit(preview); }}>Enviar recortes</button><button type="button" disabled={busy} onClick={onCancel}>Cancelar</button></div>
  </section>;
}
