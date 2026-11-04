"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AnswerKeyEditor from "./answer-key-editor";
import MatrixCalibrator from "./matrix-calibrator";
import OmrReader from "./omr-reader";

type Exam = {
  id: string;
  title: string;
  subject: string | null;
  numQuestions: number;
  numOptions: number;
  status: "draft" | "key_pending" | "key_validated";
};

type Answer = {
  q: number;
  answer: string;
  confidence: number | null;
  editedByTeacher: boolean;
};

type MatrixProfile = {
  bubbles: Array<{ questionNo: number; optionIndex: number; x: number; y: number }>;
  bubbleRadius: number;
  rowsPerBlock: number;
  blocks: number;
  optionsPerBlock: number;
  updatedAt: string;
};

type Student = {
  id: string;
  name: string;
  dni: string;
  savedAt: string | null;
  answers: Array<{ questionNo: number; optionIndex: number | null }> | null;
};

export default function ExamDetalleClient({
  examen,
  clave,
  matrixProfile,
  students,
}: {
  examen: Exam;
  clave: Answer[];
  matrixProfile: MatrixProfile | null;
  students: Student[];
}) {
  const router = useRouter();
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function guardar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMensaje("");
    const form = event.currentTarget;
    const datos = Object.fromEntries(new FormData(form));
    const numQuestions = Number(datos.numQuestions);
    const numOptions = Number(datos.numOptions);
    if (
      (numQuestions !== examen.numQuestions || numOptions !== examen.numOptions) &&
      !window.confirm("Cambiar preguntas u opciones eliminará la clave guardada. ¿Continuar?")
    ) return;

    setGuardando(true);
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
      <p><Link href="/examenes">← Mis exámenes</Link></p>
      <div className="tarjeta">
        <h2>{examen.title}</h2>
        <p className="vacio">{examen.numQuestions} preguntas × {examen.numOptions} opciones</p>
        <form onSubmit={guardar}>
          <label htmlFor="title">Título</label>
          <input id="title" name="title" defaultValue={examen.title} required maxLength={160} />
          <label htmlFor="subject">Asignatura (opcional)</label>
          <input id="subject" name="subject" defaultValue={examen.subject ?? ""} maxLength={160} />
          <label htmlFor="numQuestions">Número de preguntas (1–100)</label>
          <input id="numQuestions" name="numQuestions" type="number" min={1} max={100} defaultValue={examen.numQuestions} required />
          <label htmlFor="numOptions">Opciones por pregunta (2–26)</label>
          <input id="numOptions" name="numOptions" type="number" min={2} max={26} defaultValue={examen.numOptions} required />
          {error ? <p className="error" role="alert">{error}</p> : null}
          {mensaje ? <p className="ok" role="status">{mensaje}</p> : null}
          <div style={{ marginTop: "0.75rem" }}>
            <button type="submit" disabled={guardando}>{guardando ? "Guardando…" : "Guardar cambios"}</button>
          </div>
        </form>
      </div>
      <AnswerKeyEditor
        key={`${examen.id}-${examen.numQuestions}-${examen.numOptions}`}
        examen={{ id: examen.id, numQuestions: examen.numQuestions, numOptions: examen.numOptions, status: examen.status }}
        initialAnswers={clave}
      />
      <MatrixCalibrator
        examId={examen.id}
        numQuestions={examen.numQuestions}
        numOptions={examen.numOptions}
        initialProfile={matrixProfile}
      />
      <OmrReader
        examId={examen.id}
        numQuestions={examen.numQuestions}
        numOptions={examen.numOptions}
        profile={matrixProfile}
        initialStudents={students}
      />
    </>
  );
}
