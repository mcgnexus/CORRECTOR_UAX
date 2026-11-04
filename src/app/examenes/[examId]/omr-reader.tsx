"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { OmrAnswer, OmrProfile, OmrResult } from "@/lib/omr/read";

type Props = {
  examId: string;
  numQuestions: number;
  numOptions: number;
  profile: OmrProfile | null;
  initialStudents: Student[];
};

type Student = {
  id: string;
  name: string;
  dni: string;
  savedAt: string | null;
  answers: Array<{ questionNo: number; optionIndex: number | null }> | null;
};

type ReviewAnswer = {
  q: number;
  detected: number | null;
  confidence: number | null;
  flag: OmrAnswer["flag"] | "guardada";
  selectedOption: number | null;
  confirmed: boolean;
};

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_SIDE = 2000;
const LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const FLAGS = { ok: "Leída", blank: "En blanco", multiple: "Varias marcas", faint: "Dudosa" };

export default function OmrReader({ examId, numQuestions, numOptions, profile, initialStudents }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const previewRef = useRef<string | null>(null);
  const operationRef = useRef(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<OmrResult | null>(null);
  const [preview, setPreview] = useState("");
  const [students, setStudents] = useState(initialStudents);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [review, setReview] = useState<ReviewAnswer[] | null>(null);
  const [reviewHasUnsavedChanges, setReviewHasUnsavedChanges] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [studentError, setStudentError] = useState("");
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDni, setNewDni] = useState("");

  function reset() {
    operationRef.current += 1;
    workerRef.current?.terminate();
    workerRef.current = null;
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    setPreview("");
    setResult(null);
    setReview(null);
    setReviewHasUnsavedChanges(false);
    setSelectedStudentId("");
    setFeedback("");
    setError("");
    setProgress(0);
    setBusy(false);
    const canvas = canvasRef.current;
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }

  useEffect(() => () => {
    workerRef.current?.terminate();
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);

  function clearScan() {
    reset();
  }

  function startReview(answers: Array<{ questionNo: number; optionIndex: number | null }>, saved: boolean) {
    setResult(null);
    setReviewHasUnsavedChanges(!saved);
    setReview(answers.map((answer) => ({
      q: answer.questionNo,
      detected: answer.optionIndex,
      confidence: null,
      flag: saved ? "guardada" : "blank",
      selectedOption: answer.optionIndex,
      confirmed: saved,
    })));
  }

  function selectReviewStudent(studentId: string) {
    if (studentId !== selectedStudentId && review) {
      setReview((current) => current?.map((answer) => ({ ...answer, confirmed: false })) ?? null);
      setReviewHasUnsavedChanges(true);
    }
    setSelectedStudentId(studentId);
  }

  async function processFile(file?: File) {
    if (reviewHasUnsavedChanges && !window.confirm("La revisión actual no está guardada. ¿Descartarla y procesar otra hoja?")) return;
    reset();
    const operation = operationRef.current;
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("Elige una imagen JPG, PNG o WebP."); return; }
    if (file.size > MAX_FILE_SIZE) { setError("La imagen supera 20 MB. Elige una foto más pequeña."); return; }
    if (!profile) return;
    setBusy(true);
    try {
      const bitmap = await createImageBitmap(file);
      if (operation !== operationRef.current) { bitmap.close(); return; }
      if (bitmap.height <= bitmap.width) {
        bitmap.close();
        setError("La foto debe estar en vertical. Gira el móvil y repite la captura.");
        setBusy(false);
        return;
      }
      const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
      const width = Math.round(bitmap.width * scale);
      const height = Math.round(bitmap.height * scale);
      if (width < 600 || height < 800) {
        bitmap.close();
        setError("La resolución es insuficiente. Acerca la cámara y repite la foto.");
        setBusy(false);
        return;
      }
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d", { willReadFrequently: true });
      if (!canvas || !context) throw new Error("No se pudo preparar la imagen.");
      canvas.width = width;
      canvas.height = height;
      context.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      const imageData = context.getImageData(0, 0, width, height);
      previewRef.current = URL.createObjectURL(file);
      setPreview(previewRef.current);

      const worker = new Worker(new URL("@/lib/omr/worker.ts", import.meta.url));
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<{ type: string; value?: number; message?: string; result?: OmrResult }>) => {
        if (operation !== operationRef.current) return;
        if (event.data.type === "progress") setProgress(event.data.value ?? 0);
        if (event.data.type === "result" && event.data.result) {
          setResult(event.data.result);
          setReviewHasUnsavedChanges(true);
          setReview(event.data.result.answers.map((answer) => ({
            q: answer.q,
            detected: answer.detected,
            confidence: answer.confidence,
            flag: answer.flag,
            selectedOption: answer.detected,
            confirmed: false,
          })));
          setBusy(false);
          worker.terminate();
          workerRef.current = null;
        }
        if (event.data.type === "error") {
          setError(event.data.message ?? "No se pudo leer la hoja.");
          setBusy(false);
          worker.terminate();
          workerRef.current = null;
        }
      };
      worker.onerror = () => {
        if (operation !== operationRef.current) return;
        setError("Falló el procesamiento local de la imagen.");
        setBusy(false);
        worker.terminate();
        workerRef.current = null;
      };
      worker.postMessage({ rgba: imageData.data.buffer, width, height, profile, numQuestions, numOptions }, [imageData.data.buffer]);
    } catch (cause) {
      if (operation !== operationRef.current) return;
      setError(cause instanceof Error ? cause.message : "No se pudo abrir la imagen.");
      setBusy(false);
    }
  }

  async function createStudent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStudentError("");
    setFeedback("");
    try {
      const response = await fetch(`/api/exams/${examId}/students`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName, dni: newDni }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string; student?: { id: string; name: string; dni: string } };
      if (!response.ok || !data.student) { setStudentError(data.error ?? "No se pudo añadir el alumno."); return; }
      setStudents((current) => [...current, { ...data.student!, savedAt: null, answers: null }].sort((a, b) => a.name.localeCompare(b.name, "es")));
      selectReviewStudent(data.student.id);
      setNewName("");
      setNewDni("");
      setFeedback("Alumno añadido al roster del examen.");
    } catch {
      setStudentError("No se pudo añadir el alumno.");
    }
  }

  async function importRoster(file?: File) {
    setStudentError("");
    setFeedback("");
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setStudentError("El CSV supera 2 MB."); return; }
    setImporting(true);
    try {
      const csv = await file.text();
      const response = await fetch(`/api/exams/${examId}/students/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string; imported?: number; problems?: Array<{ row: number; message: string }> };
      if (!response.ok) {
        setStudentError([data.error, ...(data.problems ?? []).map((problem) => `Fila ${problem.row}: ${problem.message}`)].filter(Boolean).join(" "));
        return;
      }
      const refreshed = await fetch(`/api/exams/${examId}/students`);
      if (refreshed.ok) {
        const roster = await refreshed.json() as { students: Student[] };
        setStudents(roster.students);
      }
      setFeedback(`Se importaron ${data.imported ?? 0} alumnos.`);
    } catch {
      setStudentError("No se pudo leer el CSV.");
    } finally {
      setImporting(false);
    }
  }

  async function saveReview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStudentError("");
    setFeedback("");
    if (!review || review.some((answer) => !answer.confirmed)) {
      setStudentError("Confirma cada pregunta antes de guardar.");
      return;
    }
    if (!selectedStudentId) { setStudentError("Selecciona un alumno."); return; }
    const student = students.find((item) => item.id === selectedStudentId);
    const replacing = Boolean(student?.savedAt);
    if (replacing && !window.confirm(`Este alumno ya tiene una lectura guardada. ¿Reemplazarla? No se conservará historial.`)) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/exams/${examId}/results`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: selectedStudentId,
          answers: review.map((answer) => ({ questionNo: answer.q, optionIndex: answer.selectedOption })),
          ...(replacing ? { replace: true } : {}),
        }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setStudentError(data.error ?? "No se pudo guardar la lectura."); return; }
      setStudents((current) => current.map((item) => item.id === selectedStudentId ? {
        ...item,
        savedAt: new Date().toISOString(),
        answers: review.map((answer) => ({ questionNo: answer.q, optionIndex: answer.selectedOption })),
      } : item));
      setReviewHasUnsavedChanges(false);
      reset();
      setFeedback("Lectura revisada y guardada. No se almacenó la imagen ni se calculó una nota.");
    } catch {
      setStudentError("No se pudo guardar la lectura.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteResult(student: Student) {
    if (!window.confirm(`¿Eliminar la lectura guardada de ${student.name}?`)) return;
    try {
      const response = await fetch(`/api/exams/${examId}/results/${student.id}`, { method: "DELETE" });
      if (!response.ok) { setStudentError("No se pudo eliminar la lectura."); return; }
      setStudents((current) => current.map((item) => item.id === student.id ? { ...item, savedAt: null, answers: null } : item));
      if (selectedStudentId === student.id) setSelectedStudentId("");
      setFeedback("Lectura eliminada; el alumno sigue en el roster.");
    } catch {
      setStudentError("No se pudo eliminar la lectura.");
    }
  }

  async function deleteStudent(student: Student) {
    const detail = student.savedAt ? " También se eliminará su lectura guardada." : "";
    if (!window.confirm(`¿Eliminar a ${student.name} de este examen?${detail}`)) return;
    try {
      const response = await fetch(`/api/exams/${examId}/students/${student.id}?confirmResult=${Boolean(student.savedAt)}`, { method: "DELETE" });
      if (!response.ok) { setStudentError("No se pudo eliminar el alumno."); return; }
      setStudents((current) => current.filter((item) => item.id !== student.id));
      if (selectedStudentId === student.id) setSelectedStudentId("");
      setFeedback("Alumno eliminado del roster.");
    } catch {
      setStudentError("No se pudo eliminar el alumno.");
    }
  }

  function editSaved(student: Student) {
    if (!student.answers) return;
    if (reviewHasUnsavedChanges && !window.confirm("La revisión actual no está guardada. ¿Descartarla?")) return;
    clearScan();
    setSelectedStudentId(student.id);
    startReview(student.answers, true);
    setFeedback(`Revisión guardada de ${student.name}. Confirma cada pregunta si haces cambios.`);
  }

  const disabledReason = !profile
    ? "Primero calibra la matriz de este examen."
    : numQuestions > 50
      ? "La lectura está limitada a 50 preguntas hasta disponer de una matriz multipágina."
      : "";

  return <>
  <section className="tarjeta">
    <h2>Probar lectura OMR</h2>
    <p className="vacio">La detección provisional se procesa en este dispositivo. Solo al guardar, se envían el alumno elegido y las respuestas revisadas; la foto nunca se sube ni se conserva.</p>
    {disabledReason ? <p className="vacio">{disabledReason} {!profile && <Link href={`/examenes/${examId}#calibracion`}>Ir a calibración</Link>}</p> : <>
      <div className="fila-acciones">
        <label className="boton" htmlFor="omr-camera" aria-disabled={busy || saving}>Abrir cámara</label>
        <input id="omr-camera" type="file" accept="image/*" capture="environment" disabled={busy || saving} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void processFile(file); }} />
        <label className="boton secundario" htmlFor="omr-image" aria-disabled={busy || saving}>Elegir imagen</label>
        <input id="omr-image" type="file" accept="image/*" disabled={busy || saving} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void processFile(file); }} />
        {(preview || busy) && <button type="button" className="secundario" onClick={reset} disabled={busy || saving}>Reiniciar</button>}
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element -- URL local temporal: no debe pasar por el optimizador remoto. */}
      {preview && <img src={preview} alt="Previsualización temporal de la hoja" className="omr-preview" />}
      <canvas ref={canvasRef} hidden />
      {busy && <p role="status">Procesando localmente… {progress}%</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {result && <>
        <p className="ok" role="status">Lectura provisional terminada: {result.answers.length} preguntas. Revisa y confirma todas antes de guardar.</p>
      </>}
      {review && <form onSubmit={saveReview} className="omr-review">
        <label htmlFor="omr-student">Alumno del roster</label>
        <select id="omr-student" value={selectedStudentId} onChange={(event) => selectReviewStudent(event.target.value)} required>
          <option value="">Selecciona un alumno</option>
          {students.map((student) => <option key={student.id} value={student.id}>{student.name} · {student.dni}</option>)}
        </select>
        <div className="omr-table-wrap"><table><thead><tr><th>Pregunta</th><th>{review.every((answer) => answer.flag === "guardada") ? "Respuesta guardada" : "Detección provisional"}</th><th>Confianza</th><th>Respuesta final</th><th>Revisión</th></tr></thead><tbody>
          {review.map((answer, index) => <tr key={answer.q} className={!answer.confirmed ? "omr-pending" : answer.flag === "guardada" || answer.flag === "ok" ? "" : `omr-${answer.flag}`}>
            <td>{answer.q}</td>
            <td>{answer.flag === "guardada" ? (answer.detected === null ? "En blanco" : LABELS[answer.detected] ?? answer.detected + 1) : answer.detected === null ? "—" : LABELS[answer.detected] ?? answer.detected + 1} {answer.flag !== "guardada" && answer.flag !== "ok" ? `· ${FLAGS[answer.flag]}` : ""}</td>
            <td>{answer.confidence === null ? "—" : `${Math.round(answer.confidence * 100)}%`}</td>
            <td><select aria-label={`Respuesta final pregunta ${answer.q}`} value={answer.selectedOption === null ? "blank" : String(answer.selectedOption)} onChange={(event) => { setReviewHasUnsavedChanges(true); setReview((current) => current?.map((item, itemIndex) => itemIndex === index ? { ...item, selectedOption: event.target.value === "blank" ? null : Number(event.target.value), confirmed: false } : item) ?? null); }}>
              <option value="blank">En blanco</option>
              {Array.from({ length: numOptions }, (_, option) => <option key={option} value={option}>{LABELS[option]}</option>)}
            </select></td>
            <td>{answer.confirmed ? <span className="ok">Confirmada</span> : <button type="button" className="secundario" onClick={() => setReview((current) => current?.map((item, itemIndex) => itemIndex === index ? { ...item, confirmed: true } : item) ?? null)}>Confirmar</button>}</td>
          </tr>)}
        </tbody></table></div>
        <p className="vacio">Confirma cada pregunta individualmente. La detección inicial es provisional; no se calcula nota ni se guarda la imagen.</p>
        {studentError && <p className="error" role="alert">{studentError}</p>}
        <div className="fila-acciones"><button type="submit" disabled={saving || review.some((answer) => !answer.confirmed) || !selectedStudentId}>{saving ? "Guardando…" : "Guardar lectura revisada"}</button><button type="button" className="secundario" onClick={clearScan} disabled={saving}>Cancelar revisión</button></div>
      </form>}
      </>}
  </section>

  <section className="tarjeta">
    <h2>Roster y lecturas</h2>
    <p className="vacio">Alumnos y respuestas revisadas se guardan solo para este examen. La hoja no se conserva. El DNI se muestra únicamente al propietario del examen.</p>
    <form onSubmit={createStudent} className="omr-student-form">
      <label htmlFor="student-name">Nombre completo</label><input id="student-name" value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={160} required />
      <label htmlFor="student-dni">DNI</label><input id="student-dni" value={newDni} onChange={(event) => setNewDni(event.target.value)} maxLength={20} required />
      <button type="submit">Añadir alumno</button>
    </form>
    <div className="omr-import">
      <label htmlFor="roster-csv">Importar CSV UTF-8 (`nombre,dni`, máximo 2 MB / 1000 alumnos)</label>
      <input id="roster-csv" type="file" accept=".csv,text/csv" disabled={importing} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void importRoster(file); }} />
      {importing && <span role="status">Validando e importando…</span>}
    </div>
    {feedback && <p className="ok" role="status">{feedback}</p>}
    {students.length === 0 ? <p className="vacio">Todavía no hay alumnos en el roster.</p> : <div className="omr-table-wrap"><table><thead><tr><th>Alumno</th><th>DNI</th><th>Lectura</th><th>Acciones</th></tr></thead><tbody>
      {students.map((student) => <tr key={student.id}><td>{student.name}</td><td>{student.dni}</td><td>{student.savedAt ? `Revisada · ${new Date(student.savedAt).toLocaleString("es-ES")}` : "Pendiente"}</td><td><div className="fila-acciones">{student.savedAt && <><button type="button" className="secundario" onClick={() => editSaved(student)}>Abrir / editar</button><button type="button" className="peligro" onClick={() => void deleteResult(student)}>Eliminar lectura</button></>}<button type="button" className="peligro" onClick={() => void deleteStudent(student)}>Eliminar alumno</button></div></td></tr>)}
    </tbody></table></div>}
    {studentError && !review && <p className="error" role="alert">{studentError}</p>}
  </section>
  </>;
}
