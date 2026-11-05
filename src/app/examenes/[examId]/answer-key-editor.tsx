"use client";

import { useState } from "react";
import PdfTextExtractor from "./pdf-text-extractor";

type Answer = {
  q: number;
  answer: string;
  confidence: number | null;
  editedByTeacher: boolean;
};

type Exam = {
  id: string;
  numQuestions: number;
  numOptions: number;
  status: "draft" | "key_pending" | "key_validated";
};

export default function AnswerKeyEditor({
  examen,
  initialAnswers,
  onDraftSaved,
  onValidated,
}: {
  examen: Exam;
  initialAnswers: Answer[];
  onDraftSaved?: () => void;
  onValidated?: (recalculated: number) => void;
}) {
  const [answers, setAnswers] = useState<Answer[]>(() => {
    const existing = new Map(initialAnswers.map((item) => [item.q, item]));
    return Array.from({ length: examen.numQuestions }, (_, index) =>
      existing.get(index + 1) ?? {
        q: index + 1,
        answer: "",
        confidence: null,
        editedByTeacher: true,
      },
    );
  });
  const [text, setText] = useState("");
  const [confirmacionEnvio, setConfirmacionEnvio] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [status, setStatus] = useState(examen.status);
  const [generationFailed, setGenerationFailed] = useState(false);

  const opciones = Array.from({ length: examen.numOptions }, (_, index) => String.fromCharCode(65 + index));
  const completada = answers.every((item) => opciones.includes(item.answer));
  const textoUtil = text.trim().length >= 40 && text.length <= 100_000;

  function cambiar(q: number, answer: string) {
    setAnswers((current) => current.map((item) =>
      item.q === q ? { ...item, answer, editedByTeacher: true } : item,
    ));
    setDirty(true);
    setMensaje("");
  }

  async function generar() {
    setError("");
    setMensaje("");
    setGenerationFailed(false);
    setBusy(true);
    try {
      const response = await fetch(`/api/exams/${examen.id}/key/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        answers?: Array<{ q: number; answer: string; confidence: number }>;
        error?: string;
      };
      if (!response.ok || !data.answers) {
        setError(data.error ?? "No se pudo generar la clave.");
        setGenerationFailed(true);
        return;
      }
      setAnswers(data.answers.map((item) => ({ ...item, editedByTeacher: false })));
      setDirty(true);
      setGenerationFailed(false);
      setMensaje("Propuesta generada. Revísala y guárdala antes de validarla.");
    } catch {
      setError("No se pudo conectar con la aplicación. Inténtalo de nuevo.");
      setGenerationFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function guardar() {
    setError("");
    setMensaje("");
    setBusy(true);
    try {
      const response = await fetch(`/api/exams/${examen.id}/key`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: answers
            .filter((item) => opciones.includes(item.answer))
            .map(({ q, answer, confidence, editedByTeacher }) => ({ q, answer, confidence, editedByTeacher })),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "No se pudo guardar la clave.");
        return;
      }
      setStatus("key_pending");
      onDraftSaved?.();
      setDirty(false);
      setMensaje("Borrador guardado. La clave aún no está validada.");
    } catch {
      setError("No se pudo conectar con la aplicación. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  async function validar() {
    setError("");
    setMensaje("");
    setBusy(true);
    try {
      const saveResponse = await fetch(`/api/exams/${examen.id}/key`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: answers.map(({ q, answer, confidence, editedByTeacher }) => ({ q, answer, confidence, editedByTeacher })),
        }),
      });
      const saveData = (await saveResponse.json().catch(() => ({}))) as { error?: string };
      if (!saveResponse.ok) {
        setError(saveData.error ?? "No se pudo guardar la clave.");
        return;
      }
      onDraftSaved?.();

      const response = await fetch(`/api/exams/${examen.id}/key/validate`, { method: "POST" });
      const data = (await response.json().catch(() => ({}))) as { error?: string; problems?: string[]; recalculated?: number };
      if (!response.ok) {
        setStatus("key_pending");
        setDirty(false);
        setError([data.error, ...(data.problems ?? [])].filter(Boolean).join(" "));
        return;
      }
      setStatus("key_validated");
      onValidated?.(data.recalculated ?? 0);
      setDirty(false);
      setMensaje(`Clave validada. Se recalcularon ${data.recalculated ?? 0} entregas.`);
    } catch {
      setError("No se pudo conectar con la aplicación. La clave no se ha confirmado como validada.");
    } finally {
      setBusy(false);
    }
  }

  const statusLabel = status === "key_validated" ? "Validada" : status === "key_pending" ? "Pendiente de validar" : "Sin validar";

  return (
    <div className="tarjeta">
      <div className="clave-encabezado">
        <div>
          <h2>Clave de respuestas</h2>
          <p className="vacio">{examen.numQuestions} preguntas · estado: {statusLabel}{dirty ? " · cambios sin guardar" : ""}</p>
        </div>
      </div>

      <section className="clave-seccion" aria-labelledby="pdf-heading">
        <h3 id="pdf-heading">1. Leer el examen desde un PDF</h3>
        <PdfTextExtractor onText={setText} />
        <label htmlFor="exam-text">Texto que se enviará a DeepSeek</label>
        <textarea
          id="exam-text"
          value={text}
          onChange={(event) => setText(event.currentTarget.value.slice(0, 100_000))}
          rows={8}
          maxLength={100_000}
          placeholder="El texto extraído aparecerá aquí. Puedes corregirlo antes de generar la clave."
        />
        <p className="vacio">{text.length.toLocaleString("es-ES")} / 100.000 caracteres. El PDF y la extracción permanecen en este dispositivo.</p>
        <label className="aviso-privacidad">
          <input
            type="checkbox"
            checked={confirmacionEnvio}
            onChange={(event) => setConfirmacionEnvio(event.currentTarget.checked)}
          />
          Entiendo que al generar se enviará únicamente este texto del examen a DeepSeek; no se enviará el PDF ni datos de alumnos.
        </label>
        <button type="button" onClick={() => void generar()} disabled={busy || !confirmacionEnvio || !textoUtil}>
          {busy ? "Procesando…" : generationFailed ? "Reintentar generación con DeepSeek" : "Generar clave con DeepSeek"}
        </button>
      </section>

      <section className="clave-seccion" aria-labelledby="review-heading">
        <h3 id="review-heading">2. Revisar o introducir respuestas manualmente</h3>
        <p className="vacio">Puedes editar la propuesta o rellenar la clave sin usar IA. Las respuestas con confianza menor de 60 % se resaltan.</p>
        <div className="tabla-clave-wrap">
          <table className="tabla-clave">
            <thead>
              <tr><th>Pregunta</th><th>Respuesta correcta</th><th>Confianza IA</th></tr>
            </thead>
            <tbody>
              {answers.map((item) => (
                <tr key={item.q} className={item.confidence !== null && item.confidence < 0.6 ? "confianza-baja" : undefined}>
                  <th scope="row">{item.q}</th>
                  <td>
                    <select
                      aria-label={`Respuesta de la pregunta ${item.q}`}
                      value={item.answer}
                      onChange={(event) => cambiar(item.q, event.currentTarget.value)}
                    >
                      <option value="">Seleccionar…</option>
                      {opciones.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </td>
                  <td>{item.confidence === null ? "Manual" : `${Math.round(item.confidence * 100)} %`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {error ? <p className="error" role="alert">{error}</p> : null}
        {mensaje ? <p className="ok" role="status">{mensaje}</p> : null}
        <div className="fila-acciones" style={{ marginTop: "1rem" }}>
          <button type="button" className="secundario" onClick={() => void guardar()} disabled={busy}>
            Guardar borrador
          </button>
          <button type="button" onClick={() => void validar()} disabled={busy || !completada}>
            {busy ? "Validando…" : "Validar clave"}
          </button>
        </div>
      </section>
    </div>
  );
}
