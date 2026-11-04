"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Exam = {
  id: string;
  title: string;
  subject: string | null;
  numQuestions: number;
  numOptions: number;
  status: "draft" | "key_pending" | "key_validated";
};

export default function ExamDetalleClient({ examen }: { examen: Exam }) {
  const router = useRouter();
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function guardar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMensaje("");
    setGuardando(true);
    const datos = Object.fromEntries(new FormData(event.currentTarget));
    const respuesta = await fetch(`/api/exams/${examen.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(datos),
    });
    setGuardando(false);
    if (!respuesta.ok) {
      const cuerpo = (await respuesta.json().catch(() => ({}))) as { error?: string };
      setError(cuerpo.error ?? "No se pudieron guardar los cambios.");
      return;
    }
    setMensaje("Cambios guardados.");
    router.refresh();
  }

  return (
    <>
      <p>
        <Link href="/examenes">← Mis exámenes</Link>
      </p>
      <div className="tarjeta">
        <h2>{examen.title}</h2>
        <p className="vacio">
          {examen.numQuestions} preguntas × {examen.numOptions} opciones
        </p>
        <form onSubmit={guardar}>
          <label htmlFor="title">Título</label>
          <input id="title" name="title" defaultValue={examen.title} required maxLength={160} />
          <label htmlFor="subject">Asignatura (opcional)</label>
          <input id="subject" name="subject" defaultValue={examen.subject ?? ""} maxLength={160} />
          <label htmlFor="numQuestions">Número de preguntas (1–100)</label>
          <input
            id="numQuestions"
            name="numQuestions"
            type="number"
            min={1}
            max={100}
            defaultValue={examen.numQuestions}
            required
          />
          <label htmlFor="numOptions">Opciones por pregunta (2–26)</label>
          <input
            id="numOptions"
            name="numOptions"
            type="number"
            min={2}
            max={26}
            defaultValue={examen.numOptions}
            required
          />
          {error ? <p className="error">{error}</p> : null}
          {mensaje ? <p className="ok">{mensaje}</p> : null}
          <div style={{ marginTop: "0.75rem" }}>
            <button type="submit" disabled={guardando}>
              {guardando ? "Guardando…" : "Guardar cambios"}
            </button>
          </div>
        </form>
      </div>
      <div className="tarjeta">
        <h2>Siguientes pasos</h2>
        <p className="vacio">
          La clave del examen (generación con IA, revisión y validación) llega en la Fase 1. La
          plantilla imprimible y la corrección por foto se incorporarán en las fases siguientes.
        </p>
      </div>
    </>
  );
}
