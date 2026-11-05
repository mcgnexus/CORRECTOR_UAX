"use client";

import { useRef, useState } from "react";
import { createWorker } from "tesseract.js";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_PAGES = 50;
const TEXT_PAGE_THRESHOLD = 40;

type Props = {
  onText: (text: string) => void;
};

export default function PdfTextExtractor({ onText }: Props) {
  const [error, setError] = useState("");
  const [estado, setEstado] = useState("");
  const [progreso, setProgreso] = useState(0);
  const cancelado = useRef(false);

  async function procesar(file?: File) {
    setError("");
    setEstado("");
    setProgreso(0);
    onText("");
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      setError("Selecciona un archivo PDF.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError("El PDF supera el límite de 20 MB.");
      return;
    }

    cancelado.current = false;
    let ocrWorker: Awaited<ReturnType<typeof createWorker>> | undefined;
    let loadingTask: ReturnType<typeof getDocument> | undefined;
    try {
      GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      setEstado("Leyendo el PDF en este dispositivo…");
      const bytes = new Uint8Array(await file.arrayBuffer());
      loadingTask = getDocument({ data: bytes });
      const pdf = await loadingTask.promise;
      if (pdf.numPages > MAX_PAGES) {
        throw new Error("El PDF supera el límite de 50 páginas.");
      }

      const pages: string[] = [];
      const pagesOcr = new Set<number>();
      for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
        if (cancelado.current) return;
        const page = await pdf.getPage(pageNo);
        const content = await page.getTextContent();
        const text = content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ")
          .trim();
        pages.push(text);
        if (text.length < TEXT_PAGE_THRESHOLD) pagesOcr.add(pageNo);
        setProgreso(Math.round((pageNo / pdf.numPages) * (pagesOcr.size > 0 ? 20 : 100)));
      }

      if (pagesOcr.size > 0) {
        setEstado(`Aplicando OCR local en español a ${pagesOcr.size} página(s)…`);
        ocrWorker = await createWorker("spa", 1, {
          logger: (message) => {
            if (message.status === "recognizing text") {
              const completadas = [...pagesOcr].filter((pageNo) => pageNo <= Number(message.progress ?? 0) * pdf.numPages).length;
              setProgreso(Math.min(99, 20 + Math.round((Number(message.progress ?? 0) * 80)) + completadas));
            }
          },
        });

        let ocrDone = 0;
        for (const pageNo of pagesOcr) {
          if (cancelado.current) return;
          const page = await pdf.getPage(pageNo);
          const viewport = page.getViewport({ scale: 1.6 });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext("2d");
          if (!context) throw new Error("No se pudo preparar una página para OCR.");
          await page.render({ canvas, canvasContext: context, viewport }).promise;
          const result = await ocrWorker.recognize(canvas);
          const recognized = result.data.text.trim();
          if (recognized.length > pages[pageNo - 1].length) pages[pageNo - 1] = recognized;
          canvas.width = 0;
          canvas.height = 0;
          ocrDone += 1;
          setProgreso(20 + Math.round((ocrDone / pagesOcr.size) * 80));
        }
      }

      if (cancelado.current) return;
      const extracted = pages.map((text, index) => `--- Página ${index + 1} ---\n${text}`).join("\n\n").trim();
      onText(extracted);
      setEstado(extracted.length < 40
        ? "No se encontró texto suficiente. Puedes introducir la clave manualmente."
        : `Texto extraído (${extracted.length.toLocaleString("es-ES")} caracteres).`);
      setProgreso(100);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo leer el PDF. Prueba con otro archivo o introduce la clave manualmente.");
    } finally {
      await ocrWorker?.terminate();
      await loadingTask?.destroy();
    }
  }

  function cancelar() {
    cancelado.current = true;
    setEstado("Procesamiento cancelado. El archivo no se ha subido.");
    setProgreso(0);
  }

  const trabajando = estado.includes("Leyendo") || estado.includes("OCR");

  return (
    <div>
      <label htmlFor="exam-pdf">PDF del examen (máximo 20 MB y 50 páginas)</label>
      <input
        id="exam-pdf"
        type="file"
        accept="application/pdf,.pdf"
        disabled={trabajando}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          void procesar(file);
        }}
      />
      {trabajando ? (
        <div style={{ marginTop: "0.6rem" }}>
          <progress value={progreso} max={100} aria-label="Progreso de extracción" style={{ width: "100%" }} />
          <p className="vacio">{estado}</p>
          <button type="button" className="secundario" onClick={cancelar}>Cancelar</button>
        </div>
      ) : estado ? <p className="vacio">{estado}</p> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      <p className="vacio">El archivo permanece en este dispositivo. Si una página no tiene texto seleccionable, se aplica OCR local en español.</p>
    </div>
  );
}
