"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AnswerKeyEditor from "./answer-key-editor";
import MatrixCalibrator from "./matrix-calibrator";
import UaxGridCalibrator from "./uax-grid-calibrator";
import OmrReader from "./omr-reader";
import type { MatrixProfileInput, SheetFormat } from "@/lib/matrix/profile";

type Exam = {
  id: string;
  title: string;
  subject: string | null;
  numQuestions: number;
  numOptions: number;
  sheetFormat: SheetFormat;
  structureVersion: number;
  status: "draft" | "key_pending" | "key_validated";
};

type Answer = {
  q: number;
  answer: string;
  confidence: number | null;
  editedByTeacher: boolean;
};

type MatrixProfile = MatrixProfileInput & { updatedAt: string };

type Student = {
  id: string;
  name: string;
  dni: string | null;
  savedAt: string | null;
  answers: Array<{ questionNo: number; optionIndex: number | null }> | null;
  correct: number | null;
  wrong: number | null;
  blank: number | null;
  rawScore: string | null;
  score: string | null;
  version: number | null;
};

type ScoringRule = { pointsCorrect: string; pointsWrong: string; pointsBlank: string; maxScore: string };

export default function ExamDetalleClient({
  examen,
  clave,
  matrixProfile: initialMatrixProfile,
  students,
  scoringRule,
  ownerId,
}: {
  examen: Exam;
  clave: Answer[];
  matrixProfile: MatrixProfile | null;
  students: Student[];
  scoringRule: ScoringRule;
  ownerId: string;
}) {
  const router = useRouter();
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [roster, setRoster] = useState(students);
  const [matrixProfile, setMatrixProfile] = useState(initialMatrixProfile);
  const [sheetFormat, setSheetFormat] = useState<SheetFormat>(examen.sheetFormat);
  const [rule, setRule] = useState(scoringRule);
  const [examStatus, setExamStatus] = useState(examen.status);
  const [guardandoRegla, setGuardandoRegla] = useState(false);
  const [errorRegla, setErrorRegla] = useState("");
  const [mensajeRegla, setMensajeRegla] = useState("");
  const rosterRefreshRef = useRef(0);
  const [csvDelimiter, setCsvDelimiter] = useState<"," | ";">(";");

  function exportHref(type: "key" | "results" | "report", format: "csv" | "xlsx" | "pdf" | "json", studentId?: string) {
    const params = new URLSearchParams({ type, format });
    if (format === "csv") params.set("delimiter", csvDelimiter);
    if (studentId) params.set("studentId", studentId);
    return `/api/exams/${examen.id}/export?${params.toString()}`;
  }

  async function refreshRoster() {
    const refreshId = ++rosterRefreshRef.current;
    try {
      const response = await fetch(`/api/exams/${examen.id}/students`);
      if (!response.ok) return;
      const data = await response.json() as { students: Student[] };
      if (refreshId === rosterRefreshRef.current) setRoster(data.students);
    } catch {
      setError("No se pudo actualizar el resumen de entregas.");
    }
  }

  async function guardarRegla(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorRegla("");
    setMensajeRegla("");
    setGuardandoRegla(true);
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget));
      const response = await fetch(`/api/exams/${examen.id}/scoring`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pointsCorrect: values.pointsCorrect,
          pointsWrong: values.pointsWrong,
          pointsBlank: values.pointsBlank,
          maxScore: values.maxScore,
        }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string; rule?: ScoringRule; recalculated?: number; keyValidated?: boolean };
      if (!response.ok || !data.rule) { setErrorRegla(data.error ?? "No se pudo guardar la regla."); return; }
      setRule(data.rule);
      if (data.keyValidated !== undefined) setExamStatus(data.keyValidated ? "key_validated" : "key_pending");
      setMensajeRegla(data.keyValidated
        ? `Regla guardada; se recalcularon ${data.recalculated ?? 0} entregas.`
        : "Regla guardada. Las notas se calcularán al validar la clave.");
      await refreshRoster();
    } catch {
      setErrorRegla("No se pudo guardar la regla de puntuación.");
    } finally {
      setGuardandoRegla(false);
    }
  }

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
      !window.confirm("Cambiar preguntas u opciones eliminará la clave y la calibración guardadas. ¿Continuar?")
    ) return;
    if (sheetFormat !== examen.sheetFormat && !window.confirm("Cambiar el formato eliminará la calibración guardada. La clave se conservará si no cambian preguntas ni opciones. ¿Continuar?")) return;

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
        <h1>{examen.title}</h1>
        <p className="vacio">{examen.numQuestions} preguntas × {examen.numOptions} opciones</p>
        <form onSubmit={guardar}>
          <label htmlFor="title">Título</label>
          <input id="title" name="title" defaultValue={examen.title} required maxLength={160} />
          <label htmlFor="subject">Asignatura (opcional)</label>
          <input id="subject" name="subject" defaultValue={examen.subject ?? ""} maxLength={160} />
          <label htmlFor="sheetFormat">Formato de hoja</label>
          <select id="sheetFormat" name="sheetFormat" value={sheetFormat} onChange={(event) => setSheetFormat(event.target.value as SheetFormat)}>
            <option value="bubbles">Burbujas</option>
            <option value="uax-grid-40">UAX letras 40 × 4 (experimental)</option>
          </select>
          {sheetFormat === "uax-grid-40" && <p className="aviso">Este formato requiere 40 preguntas y cuatro opciones. La lectura es experimental y debe revisarse íntegramente.</p>}
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
        onDraftSaved={() => { setExamStatus("key_pending"); void refreshRoster(); }}
        onValidated={() => { setExamStatus("key_validated"); void refreshRoster(); }}
      />
      <section className="tarjeta">
        <h2>Regla de puntuación</h2>
        <p className="vacio">Aciertos suman puntos; fallos y blancos pueden penalizar. La nota se escala al máximo y se limita entre 0 y ese máximo. Valores por defecto: 1 punto por acierto, sin penalización y nota máxima 10.</p>
        {examStatus !== "key_validated" && <p className="aviso">La clave está pendiente de validar. No se mostrarán notas hasta validarla.</p>}
        <form onSubmit={guardarRegla} className="omr-student-form">
          <label htmlFor="points-correct">Puntos por acierto (&gt; 0)</label><input id="points-correct" name="pointsCorrect" type="number" step="0.0001" min="0.0001" defaultValue={rule.pointsCorrect} required />
          <label htmlFor="points-wrong">Puntos por fallo (&le; 0)</label><input id="points-wrong" name="pointsWrong" type="number" step="0.0001" max="0" defaultValue={rule.pointsWrong} required />
          <label htmlFor="points-blank">Puntos por blanco (&le; 0)</label><input id="points-blank" name="pointsBlank" type="number" step="0.0001" max="0" defaultValue={rule.pointsBlank} required />
          <label htmlFor="max-score">Nota máxima (&gt; 0)</label><input id="max-score" name="maxScore" type="number" step="0.0001" min="0.0001" defaultValue={rule.maxScore} required />
          {errorRegla && <p className="error" role="alert">{errorRegla}</p>}
          {mensajeRegla && <p className="ok" role="status">{mensajeRegla}</p>}
          <button type="submit" disabled={guardandoRegla}>{guardandoRegla ? "Recalculando…" : "Guardar regla"}</button>
        </form>
      </section>
      <section className="tarjeta" aria-labelledby="export-heading">
        <h2 id="export-heading">Exportar</h2>
        <p className="vacio">Las descargas contienen únicamente datos de este examen. Resultados incluye nombre y DNI/NIE; la clave no incluye datos de alumnos.</p>
        {examStatus !== "key_validated" && <p className="aviso">Las exportaciones de clave en borrador se marcarán como no validadas; su PDF incluirá una advertencia visible.</p>}
        <label htmlFor="export-delimiter">Separador CSV</label>
        <select id="export-delimiter" value={csvDelimiter} onChange={(event) => setCsvDelimiter(event.target.value as "," | ";")}>
          <option value=";">Punto y coma (;), recomendado para Excel en español</option>
          <option value=",">Coma (,)</option>
        </select>
        <div className="export-groups">
          <div>
            <h3>Clave</h3>
            <div className="export-actions">
              <a href={exportHref("key", "csv")} className="export-link">CSV</a>
              <a href={exportHref("key", "xlsx")} className="export-link">Excel (.xlsx)</a>
              <a href={exportHref("key", "pdf")} className="export-link">PDF imprimible</a>
              <a href={exportHref("key", "json")} className="export-link">JSON</a>
            </div>
          </div>
          <div>
            <h3>Resultados y roster</h3>
            <div className="export-actions">
              <a href={exportHref("results", "csv")} className="export-link">CSV</a>
              <a href={exportHref("results", "xlsx")} className="export-link">Excel (.xlsx)</a>
              <a href={exportHref("results", "pdf")} className="export-link">PDF por alumno</a>
            </div>
          </div>
          <div>
            <h3>Informe de corrección</h3>
            <p className="vacio">Incluye la respuesta de cada alumno, la correcta en los fallos y el cálculo paso a paso de la nota.</p>
            <div className="export-actions">
              <a href={exportHref("report", "csv")} className="export-link">CSV</a>
              <a href={exportHref("report", "xlsx")} className="export-link">Excel (.xlsx)</a>
              <a href={exportHref("report", "pdf")} className="export-link">PDF por alumno</a>
            </div>
          </div>
        </div>
      </section>
      {examen.sheetFormat === "uax-grid-40" ? <UaxGridCalibrator
        examId={examen.id}
        initialProfile={matrixProfile?.format === "uax-grid-40" ? matrixProfile : null}
        onProfileChange={setMatrixProfile}
      /> : <MatrixCalibrator
        examId={examen.id}
        numQuestions={examen.numQuestions}
        numOptions={examen.numOptions}
        initialProfile={matrixProfile && matrixProfile.format !== "uax-grid-40" ? matrixProfile : null}
        onProfileChange={setMatrixProfile}
      />}
      <p><Link href="/alumnos">Abrir mi base de alumnos e importar Excel</Link>. Desde allí puedes asignar alumnos a este examen sin repetir la importación.</p>
      <OmrReader
        sheetFormat={examen.sheetFormat}
        ownerId={ownerId}
        examId={examen.id}
        structureVersion={examen.structureVersion}
        numQuestions={examen.numQuestions}
        numOptions={examen.numOptions}
        profile={matrixProfile}
        initialStudents={roster}
        onStudentsChange={setRoster}
        keyValidated={examStatus === "key_validated"}
        onKeyPending={() => { setExamStatus("key_pending"); void refreshRoster(); }}
      />
    </>
  );
}
