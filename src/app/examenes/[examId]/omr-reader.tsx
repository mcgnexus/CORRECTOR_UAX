"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OmrAnswer, OmrProfile, OmrResult } from "@/lib/omr/read";
import { detectRegistrationMarkers, markersFromPoints, type MatrixMarker, type Point } from "@/lib/matrix/detect";
import { deleteQueuedResult, listQueuedResults, purgeQueuedResults, saveQueuedResult, type QueuedResult } from "@/lib/offline-queue/indexed-db";
import { applyQueueDecision, classifyQueueResponse } from "@/lib/offline-queue/queue-state";

type Props = {
  examId: string;
  ownerId: string;
  numQuestions: number;
  numOptions: number;
  profile: OmrProfile | null;
  initialStudents: Student[];
  onStudentsChange: (students: Student[]) => void;
  keyValidated: boolean;
  onKeyPending: () => void;
};

type Student = {
  id: string;
  name: string;
  dni: string;
  savedAt: string | null;
  answers: Array<{ questionNo: number; optionIndex: number | null }> | null;
  correct: number | null;
  wrong: number | null;
  blank: number | null;
  rawScore: string | null;
  score: string | null;
  version: number | null;
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

export default function OmrReader({ examId, ownerId, numQuestions, numOptions, profile, initialStudents: students, onStudentsChange, keyValidated, onKeyPending }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const bitmapRef = useRef<ImageBitmap | null>(null);
  const operationRef = useRef(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<OmrResult | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [tone, setTone] = useState({ brightness: 0, contrast: 1 });
  const [manualMode, setManualMode] = useState(false);
  const [markerClicks, setMarkerClicks] = useState<Point[]>([]);
  const [detectedMarkers, setDetectedMarkers] = useState<MatrixMarker[] | null>(null);
  const paintParamsRef = useRef({ angle: 0, brightness: 0, contrast: 1 });
  const [profileAtReadStart, setProfileAtReadStart] = useState(profile);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [review, setReview] = useState<ReviewAnswer[] | null>(null);
  const [reviewHasUnsavedChanges, setReviewHasUnsavedChanges] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [studentError, setStudentError] = useState("");
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDni, setNewDni] = useState("");
  const [queued, setQueued] = useState<QueuedResult[]>([]);
  const [queueNotice, setQueueNotice] = useState("");
  const [comparisons, setComparisons] = useState<Record<string, Student | null | undefined>>({});
  const pendingSaveRef = useRef<{ key: string; body: string } | null>(null);
  const queuedReplacementRef = useRef<string | null>(null);
  const queuedPersistedKeyRef = useRef<string | null>(null);
  const lastAutoRetryRef = useRef(new Map<string, number>());

  function reset() {
    operationRef.current += 1;
    pendingSaveRef.current = null;
    queuedReplacementRef.current = null;
    queuedPersistedKeyRef.current = null;
    workerRef.current?.terminate();
    workerRef.current = null;
    bitmapRef.current?.close();
    bitmapRef.current = null;
    setImageLoaded(false);
    setRotation(0);
    setTone({ brightness: 0, contrast: 1 });
    setManualMode(false);
    setMarkerClicks([]);
    setDetectedMarkers(null);
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
    bitmapRef.current?.close();
  }, []);


  const refreshQueue = useCallback(async () => {
    try { setQueued(await listQueuedResults(ownerId)); }
    catch { setQueueNotice("No se pudo leer la cola local; comprueba el espacio disponible del navegador."); }
  }, [ownerId]);

  useEffect(() => {
    void Promise.resolve().then(refreshQueue);
    const onOnline = () => { void refreshQueue(); };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [ownerId, refreshQueue]);

  const sendQueued = useCallback(async (entry: QueuedResult, manual = false) => {
    if (entry.ownerId !== ownerId || entry.status === "blocked") return;
    if (entry.lastError === "key_pending") {
      const examResponse = await fetch(`/api/exams/${entry.examId}`);
      if (!examResponse.ok || ((await examResponse.json() as { status?: string }).status !== "key_validated")) {
        setQueueNotice("La cola espera que se valide la clave del examen.");
        return;
      }
    }
    const lastAttempt = lastAutoRetryRef.current.get(entry.id) ?? 0;
    if (!manual && Date.now() - lastAttempt < 30_000) return;
    lastAutoRetryRef.current.set(entry.id, Date.now());
    try {
      const response = await fetch(`/api/exams/${entry.examId}/results`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": entry.idempotencyKey },
        body: JSON.stringify({ studentId: entry.studentId, answers: entry.answers, replace: entry.replace, expectedVersion: entry.expectedVersion }),
      });
      const responseBody = await response.json().catch(() => ({})) as { code?: string };
      const decision = classifyQueueResponse(response.status, responseBody.code);
      const nextEntry = applyQueueDecision(entry, decision);
      if (decision.action === "ack") {
        await deleteQueuedResult(ownerId, entry.id);
        setQueueNotice("Una entrega pendiente se ha sincronizado.");
        const rosterResponse = await fetch(`/api/exams/${entry.examId}/students`);
        if (rosterResponse.ok) onStudentsChange((await rosterResponse.json() as { students: Student[] }).students);
      } else if (decision.action === "discard") {
        await deleteQueuedResult(ownerId, entry.id);
        setQueueNotice("Se descartó una entrega local porque el examen o alumno ya no existe.");
      } else {
        await saveQueuedResult(nextEntry!);
      }
    } catch {
      await saveQueuedResult({ ...entry, retries: entry.retries + 1, lastError: "network" }).catch(() => undefined);
    }
    await refreshQueue();
  }, [ownerId, onStudentsChange, refreshQueue]);

  useEffect(() => {
    const retry = () => {
      if (!navigator.onLine || document.visibilityState !== "visible") return;
      void listQueuedResults(ownerId).then((items) => items.filter((item) => item.status === "pending").slice(0, 3).forEach((item) => void sendQueued(item)));
    };
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", retry);
    retry();
    return () => { window.removeEventListener("online", retry); document.removeEventListener("visibilitychange", retry); };
  }, [ownerId, sendQueued, keyValidated]);

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
    pendingSaveRef.current = null;
    if (studentId !== selectedStudentId && review) {
      setReview((current) => current?.map((answer) => ({ ...answer, confirmed: false })) ?? null);
      setReviewHasUnsavedChanges(true);
    }
    setSelectedStudentId(studentId);
  }

  function drawMarkers(markers: MatrixMarker[]) {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.save();
    context.lineWidth = Math.max(2, canvas.width / 500);
    context.strokeStyle = "#2a9d8f";
    for (const marker of markers) {
      const size = Math.max(12, marker.size);
      context.strokeRect(marker.x - size / 2, marker.y - size / 2, size, size);
    }
    context.restore();
  }

  function applyToneData(context: CanvasRenderingContext2D, width: number, height: number, settings: { brightness: number; contrast: number }) {
    if (settings.brightness === 0 && settings.contrast === 1) return;
    const imageData = context.getImageData(0, 0, width, height);
    const data = imageData.data;
    for (let offset = 0; offset < data.length; offset += 4) {
      data[offset] = Math.max(0, Math.min(255, (data[offset] - 128) * settings.contrast + 128 + settings.brightness));
      data[offset + 1] = Math.max(0, Math.min(255, (data[offset + 1] - 128) * settings.contrast + 128 + settings.brightness));
      data[offset + 2] = Math.max(0, Math.min(255, (data[offset + 2] - 128) * settings.contrast + 128 + settings.brightness));
    }
    context.putImageData(imageData, 0, 0);
  }

  function paint(angle: number, settings: { brightness: number; contrast: number }) {
    const bitmap = bitmapRef.current;
    const canvas = canvasRef.current;
    if (!bitmap || !canvas) return null;
    const swapped = angle === 90 || angle === 270;
    const rawWidth = swapped ? bitmap.height : bitmap.width;
    const rawHeight = swapped ? bitmap.width : bitmap.height;
    const factor = Math.min(1, MAX_SIDE / Math.max(rawWidth, rawHeight));
    const width = Math.round(rawWidth * factor);
    const height = Math.round(rawHeight * factor);
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) { setError("No se pudo preparar la imagen."); setBusy(false); return null; }
    context.save();
    context.translate(width / 2, height / 2);
    context.rotate((angle * Math.PI) / 180);
    const drawWidth = Math.round(bitmap.width * factor);
    const drawHeight = Math.round(bitmap.height * factor);
    context.drawImage(bitmap, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    context.restore();
    applyToneData(context, width, height, settings);
    paintParamsRef.current = { angle, brightness: settings.brightness, contrast: settings.contrast };
    setRotation(angle);
    setTone(settings);
    return { canvas, context, width, height };
  }

  function renderAndAnalyze(angle: number, settings: { brightness: number; contrast: number }, override?: MatrixMarker[]) {
    const painted = paint(angle, settings);
    if (!painted) { setBusy(false); return; }
    const { context, width, height } = painted;

    if (override) {
      setDetectedMarkers(override);
      setManualMode(false);
      setMarkerClicks([]);
      drawMarkers(override);
      startRead(override);
      return;
    }

    const pixels = context.getImageData(0, 0, width, height);
    const gray = new Uint8Array(width * height);
    for (let index = 0; index < gray.length; index += 1) {
      const offset = index * 4;
      gray[index] = Math.round(pixels.data[offset] * 0.299 + pixels.data[offset + 1] * 0.587 + pixels.data[offset + 2] * 0.114);
    }
    const markers = detectRegistrationMarkers({ width, height, data: gray });
    if (!markers) {
      setDetectedMarkers(null);
      setManualMode(true);
      setMarkerClicks([]);
      setBusy(false);
      setError("No se detectaron las cuatro marcas. Toca sus esquinas en la imagen para indicarlas manualmente.");
      return;
    }
    setDetectedMarkers(markers);
    setManualMode(false);
    setMarkerClicks([]);
    drawMarkers(markers);
    startRead(markers);
  }

  function startRead(markers: MatrixMarker[]) {
    setProfileAtReadStart(profile);
    const params = paintParamsRef.current;
    const painted = paint(params.angle, { brightness: params.brightness, contrast: params.contrast });
    const canvas = canvasRef.current;
    const context = painted?.context ?? canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !context || !profile) return;
    const operation = operationRef.current;
    setBusy(true);
    setError("");
    setProgress(0);
    setResult(null);
    setReview(null);
    setReviewHasUnsavedChanges(false);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    drawMarkers(markers);
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
    worker.postMessage({ rgba: imageData.data.buffer, width: canvas.width, height: canvas.height, profile, numQuestions, numOptions, markers }, [imageData.data.buffer]);
  }

  async function processFile(file?: File) {
    if (reviewHasUnsavedChanges && !window.confirm("La revisión actual no está guardada. ¿Descartarla y procesar otra hoja?")) return;
    reset();
    const operation = operationRef.current;
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("Elige una imagen JPG, PNG o WebP."); return; }
    if (file.size > MAX_FILE_SIZE) { setError("La imagen supera 20 MB. Elige una foto más pequeña."); return; }
    if (!profile || !keyValidated) return;
    setBusy(true);
    try {
      const bitmap = await createImageBitmap(file);
      if (operation !== operationRef.current) { bitmap.close(); return; }
      if (Math.min(bitmap.width, bitmap.height) < 600) {
        bitmap.close();
        setError("La resolución es insuficiente. Acerca la cámara y repite la foto.");
        setBusy(false);
        return;
      }
      bitmapRef.current = bitmap;
      setImageLoaded(true);
      renderAndAnalyze(bitmap.height <= bitmap.width ? 90 : 0, { brightness: 0, contrast: 1 });
    } catch (cause) {
      if (operation !== operationRef.current) return;
      setError(cause instanceof Error ? cause.message : "No se pudo abrir la imagen.");
      setBusy(false);
    }
  }

  function rotateImage(delta: number) {
    if (!bitmapRef.current) return;
    renderAndAnalyze((rotation + delta + 360) % 360, tone);
  }

  function startManualMarkers() {
    const canvas = canvasRef.current;
    if (!canvas || !imageLoaded) return;
    setManualMode(true);
    setMarkerClicks([]);
    setDetectedMarkers(null);
    setError("");
    setResult(null);
    setReview(null);
    setBusy(false);
    setProgress(0);
  }

  function onCanvasClick(event: React.MouseEvent<HTMLCanvasElement>) {
    if (!manualMode) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
    const context = canvas.getContext("2d");
    if (context) {
      context.save();
      context.fillStyle = "#1d3557";
      context.beginPath();
      context.arc(x, y, Math.max(4, canvas.width / 250), 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
    const next = [...markerClicks, { x, y }];
    if (next.length < 4) {
      setMarkerClicks(next);
      setError("Marca " + next.length + " de 4 esquinas.");
      return;
    }
    const markers = markersFromPoints(next);
    if (!markers) {
      setMarkerClicks([]);
      setError("Esas cuatro esquinas no forman un área válida. Vuelve a marcarlas.");
      return;
    }
    setMarkerClicks([]);
    setDetectedMarkers(markers);
    setManualMode(false);
    drawMarkers(markers);
    startRead(markers);
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
      onStudentsChange([...students, { ...data.student!, savedAt: null, answers: null, correct: null, wrong: null, blank: null, rawScore: null, score: null, version: null }].sort((a, b) => a.name.localeCompare(b.name, "es")));
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
        onStudentsChange(roster.students);
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
    if (!keyValidated) { setStudentError("Valida la clave antes de guardar una entrega puntuada."); return; }
    const student = students.find((item) => item.id === selectedStudentId);
    const replacing = Boolean(student?.savedAt);
    if (replacing && !window.confirm(`Este alumno ya tiene una lectura guardada. ¿Reemplazarla? No se conservará historial.`)) return;
    const body = JSON.stringify({
      studentId: selectedStudentId,
      answers: review.map((answer) => ({ questionNo: answer.q, optionIndex: answer.selectedOption })),
      replace: replacing,
      expectedVersion: student?.version ?? null,
    });
    if (!pendingSaveRef.current || pendingSaveRef.current.body !== body) {
      pendingSaveRef.current = { key: crypto.randomUUID(), body };
    }
    setSaving(true);
    try {
      const replacingQueuedId = queuedReplacementRef.current;
      if (replacingQueuedId) {
        const payload = JSON.parse(body) as { studentId: string; answers: QueuedResult["answers"]; replace: boolean; expectedVersion: number | null };
        await saveQueuedResult({
          id: pendingSaveRef.current.key,
          ownerId,
          examId,
          ...payload,
          idempotencyKey: pendingSaveRef.current.key,
          createdAt: new Date().toISOString(),
          status: "pending",
          retries: 0,
          lastError: null,
        });
        queuedPersistedKeyRef.current = pendingSaveRef.current.key;
        try {
          await deleteQueuedResult(ownerId, replacingQueuedId);
          queuedReplacementRef.current = null;
        } catch {
          setQueueNotice("Se guardó la nueva entrega local, pero no se pudo retirar el conflicto anterior; elimínalo tras confirmar el resultado.");
        }
        await refreshQueue();
      }
      const response = await fetch(`/api/exams/${examId}/results`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": pendingSaveRef.current.key },
        body,
      });
      const data = await response.json().catch(() => ({})) as { error?: string; code?: string; result?: Student };
      if (!response.ok) {
        if (response.status === 401 || response.status >= 500 || data.code === "key_not_validated") {
          const payload = JSON.parse(body) as { studentId: string; answers: QueuedResult["answers"]; replace: boolean; expectedVersion: number | null };
          await saveQueuedResult({
            id: pendingSaveRef.current.key,
            ownerId,
            examId,
            ...payload,
            idempotencyKey: pendingSaveRef.current.key,
            createdAt: new Date().toISOString(),
            status: "pending",
            retries: 0,
            lastError: response.status === 401 ? "unauthorized" : response.status >= 500 ? "server" : "key_pending",
          });
          await refreshQueue();
          reset();
          setQueueNotice("Entrega guardada en la cola local. IndexedDB no está cifrada por la aplicación; no cierres sesión en este dispositivo si necesitas sincronizarla.");
        }
        if (response.status === 409 && ["exists", "version_conflict", "idempotency_conflict"].includes(data.code ?? "")) {
          const payload = JSON.parse(body) as { studentId: string; answers: QueuedResult["answers"]; replace: boolean; expectedVersion: number | null };
          await saveQueuedResult({
            id: pendingSaveRef.current.key,
            ownerId,
            examId,
            ...payload,
            idempotencyKey: pendingSaveRef.current.key,
            createdAt: new Date().toISOString(),
            status: "blocked",
            retries: 0,
            lastError: data.code as QueuedResult["lastError"],
          });
          await refreshQueue();
          setQueueNotice("La entrega se guardó en la cola local como conflicto. Compara las respuestas antes de reemplazar.");
        }
        if (response.status === 404 || response.status === 410) {
          if (pendingSaveRef.current && queuedPersistedKeyRef.current) {
            await deleteQueuedResult(ownerId, queuedPersistedKeyRef.current).catch(() => undefined);
            queuedPersistedKeyRef.current = null;
          }
          reset();
          await refreshQueue();
          setStudentError("El examen, alumno o entrega ya no existe. Se descartó la copia local asociada.");
          return;
        }
        if (response.status < 500 && response.status !== 401 && data.code !== "key_not_validated" && !["exists", "version_conflict", "idempotency_conflict"].includes(data.code ?? "")) {
          const payload = JSON.parse(body) as { studentId: string; answers: QueuedResult["answers"]; replace: boolean; expectedVersion: number | null };
          await saveQueuedResult({
            id: pendingSaveRef.current.key,
            ownerId,
            examId,
            ...payload,
            idempotencyKey: pendingSaveRef.current.key,
            createdAt: new Date().toISOString(),
            status: "blocked",
            retries: 0,
            lastError: "rejected",
          });
          await refreshQueue();
        }
        queuedPersistedKeyRef.current = null;
        if (response.status < 500) pendingSaveRef.current = null;
        if (data.code === "version_conflict") {
          reset();
          const rosterResponse = await fetch(`/api/exams/${examId}/students`);
          if (rosterResponse.ok) onStudentsChange((await rosterResponse.json() as { students: Student[] }).students);
          setStudentError("La entrega se modificó en otro dispositivo. Vuelve a abrir la versión actual antes de editarla.");
        } else {
          if (data.code === "key_not_validated") onKeyPending();
          setStudentError(data.error ?? "No se pudo guardar la lectura.");
        }
        return;
      }
      pendingSaveRef.current = null;
      if (data.result?.score === null) onKeyPending();
      const persistedQueueKey = queuedPersistedKeyRef.current;
      queuedPersistedKeyRef.current = null;
      if (persistedQueueKey) {
        try {
          await deleteQueuedResult(ownerId, persistedQueueKey);
          await refreshQueue();
        } catch {
          setQueueNotice("El servidor confirmó la entrega, pero la copia local no se pudo retirar; elimínala manualmente.");
        }
      }
      onStudentsChange(students.map((item) => item.id === selectedStudentId ? {
        ...item,
        savedAt: data.result?.savedAt ?? new Date().toISOString(),
        answers: review.map((answer) => ({ questionNo: answer.q, optionIndex: answer.selectedOption })),
        correct: data.result?.correct ?? null,
        wrong: data.result?.wrong ?? null,
        blank: data.result?.blank ?? null,
        rawScore: data.result?.rawScore ?? null,
        score: data.result?.score ?? null,
        version: data.result?.version ?? null,
      } : item));
      setReviewHasUnsavedChanges(false);
      reset();
      setFeedback(`Entrega guardada. Aciertos ${data.result?.correct ?? 0}, fallos ${data.result?.wrong ?? 0}, blancos ${data.result?.blank ?? 0}; nota ${data.result?.score ?? "pendiente"}. La imagen no se almacenó.`);
    } catch {
      const pending = pendingSaveRef.current;
      if (pending) {
        try {
          const payload = JSON.parse(pending.body) as { studentId: string; answers: QueuedResult["answers"]; replace: boolean; expectedVersion: number | null };
          await saveQueuedResult({ id: pending.key, ownerId, examId, ...payload, idempotencyKey: pending.key, createdAt: new Date().toISOString(), status: "pending", retries: 0, lastError: "network" });
          await refreshQueue();
          reset();
          setQueueNotice("Entrega guardada en la cola local. IndexedDB no está cifrada por la aplicación; no cierres sesión en este dispositivo si necesitas sincronizarla.");
          setStudentError("No se pudo conectar. La entrega revisada quedó guardada localmente para reintentar con la misma clave.");
        } catch {
          setStudentError("Falló la conexión y no se pudo escribir en IndexedDB. Mantén esta página abierta y reintenta sin cambiar las respuestas.");
        }
      } else setStudentError("No se pudo confirmar la respuesta del servidor. Reintenta sin cambiar las respuestas para consultar el mismo guardado de forma segura.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteResult(student: Student) {
    if (!window.confirm(`¿Eliminar la lectura guardada de ${student.name}?`)) return;
    try {
      const response = await fetch(`/api/exams/${examId}/results/${student.id}`, { method: "DELETE" });
      if (!response.ok) { setStudentError("No se pudo eliminar la lectura."); return; }
      await purgeQueuedResults(ownerId, { examId, studentId: student.id });
      await refreshQueue();
      onStudentsChange(students.map((item) => item.id === student.id ? { ...item, savedAt: null, answers: null, correct: null, wrong: null, blank: null, rawScore: null, score: null, version: null } : item));
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
      await purgeQueuedResults(ownerId, { examId, studentId: student.id });
      await refreshQueue();
      onStudentsChange(students.filter((item) => item.id !== student.id));
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

  async function loadQueuedComparison(entry: QueuedResult) {
    setComparisons((current) => ({ ...current, [entry.id]: undefined }));
    try {
      const response = await fetch(`/api/exams/${entry.examId}/students`);
      if (!response.ok) throw new Error("No se pudo cargar la entrega actual.");
      const data = await response.json() as { students: Student[] };
      onStudentsChange(data.students);
      const student = data.students.find((item) => item.id === entry.studentId) ?? null;
      setComparisons((current) => ({ ...current, [entry.id]: student }));
    } catch {
      setQueueNotice("No se pudo consultar la versión actual. Comprueba la conexión y vuelve a comparar.");
      setComparisons((current) => { const next = { ...current }; delete next[entry.id]; return next; });
    }
  }

  function reopenQueuedForReplacement(entry: QueuedResult, student: Student) {
    if (student.savedAt && !student.answers) {
      setQueueNotice("La versión del servidor no incluye respuestas comparables. Puedes descartar la cola, pero no se habilita un reemplazo ciego.");
      return;
    }
    const action = student.savedAt ? "reemplazo de la entrega actual" : "nueva entrega para el alumno pendiente";
    if (!window.confirm(`Se abrirán las respuestas locales para revisarlas como ${action}. Confirma todas las preguntas; se usará la versión actual y una clave idempotente nueva.`)) return;
    reset();
    queuedReplacementRef.current = entry.id;
    setSelectedStudentId(student.id);
    setReview(entry.answers.map((answer) => ({
      q: answer.questionNo,
      detected: answer.optionIndex,
      confidence: null,
      flag: "guardada",
      selectedOption: answer.optionIndex,
      confirmed: false,
    })));
    setReviewHasUnsavedChanges(true);
    setFeedback("Respuestas pendientes cargadas. Compara con el estado del servidor, confirma cada pregunta y guarda el reemplazo explícitamente.");
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  function optionLabel(optionIndex: number | null | undefined) {
    return optionIndex === null ? "En blanco" : optionIndex === undefined ? "Sin entrega" : LABELS[optionIndex] ?? `Opción ${optionIndex + 1}`;
  }

  function queueErrorLabel(code: string | null) {
    return ({
      network: "Sin conexión; se reintentará",
      server: "Error temporal del servidor",
      unauthorized: "Inicia sesión con la cuenta propietaria",
      key_pending: "Espera a que se valide la clave",
      exists: "El alumno ya tiene una entrega",
      version_conflict: "La entrega cambió en el servidor",
      idempotency_conflict: "La clave ya se usó con otros datos",
      rejected: "El servidor rechazó la entrega; requiere revisión",
      conflict: "Conflicto antiguo; compara antes de reemplazar",
    } as Record<string, string>)[code ?? ""] ?? "Pendiente de sincronización";
  }

  const disabledReason = !keyValidated
    ? "Valida una clave completa antes de corregir hojas."
    : !profile
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
        {(imageLoaded || busy) && <button type="button" className="secundario" onClick={reset} disabled={busy || saving}>Reiniciar</button>}
      </div>
      <canvas ref={canvasRef} className="omr-preview" hidden={!imageLoaded} aria-label="Hoja cargada. Toca las cuatro esquinas de las marcas cuando se solicite." onClick={onCanvasClick} style={imageLoaded ? (manualMode ? { cursor: "crosshair" } : undefined) : { display: "none" }} />
      {imageLoaded && <div className="fila-acciones">
        <button type="button" className="secundario" onClick={() => rotateImage(-90)} disabled={busy || saving}>Girar izquierda</button>
        <button type="button" className="secundario" onClick={() => rotateImage(90)} disabled={busy || saving}>Girar derecha</button>
        <button type="button" className="secundario" onClick={startManualMarkers} disabled={busy || saving}>Marcar esquinas</button>
        <button type="button" className="secundario" onClick={() => renderAndAnalyze(rotation, tone)} disabled={busy || saving}>Releer marcas</button>
      </div>}
      {imageLoaded && <fieldset className="matriz-ajustes">
        <legend>Retoque de imagen</legend>
        <label htmlFor="omr-brightness">Brillo ({tone.brightness})</label>
        <input id="omr-brightness" type="range" min={-60} max={60} step={2} value={tone.brightness} onChange={(event) => setTone((current) => ({ ...current, brightness: Number(event.target.value) }))} />
        <label htmlFor="omr-contrast">Contraste ({tone.contrast.toFixed(2)}×)</label>
        <input id="omr-contrast" type="range" min={0.6} max={1.8} step={0.05} value={tone.contrast} onChange={(event) => setTone((current) => ({ ...current, contrast: Number(event.target.value) }))} />
        <button type="button" className="secundario" onClick={() => renderAndAnalyze(rotation, tone)} disabled={busy || saving}>Aplicar retoque y releer</button>
      </fieldset>}
      {manualMode && <p className="vacio" role="status">Marca las cuatro esquinas de las marcas de registro tocando la imagen, en cualquier orden.</p>}
      {detectedMarkers && !manualMode && <p className="vacio" role="status">Se han localizado las cuatro marcas de registro.</p>}
      {busy && <p role="status">Procesando localmente… {progress}%</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {review && reviewHasUnsavedChanges && profileAtReadStart !== profile ? <p className="aviso" role="status">La calibración cambió. Se aplicará a la próxima lectura; la revisión actual no se recalcula automáticamente.</p> : null}
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
        <div className="fila-acciones">
          <button
            type="button"
            className="secundario"
            disabled={busy || saving || review.every((answer) => answer.confirmed)}
            onClick={() => setReview((current) => current?.map((item) => ({ ...item, confirmed: true })) ?? null)}
          >
            Confirmar todas las respuestas
          </button>
        </div>
        <p className="vacio">Confirma cada pregunta o todas a la vez. La detección inicial es provisional; no se calcula nota ni se guarda la imagen.</p>
        {studentError && <p className="error" role="alert">{studentError}</p>}
        <div className="fila-acciones"><button type="submit" disabled={saving || review.some((answer) => !answer.confirmed) || !selectedStudentId || !keyValidated}>{saving ? "Guardando y puntuando…" : "Confirmar entrega y nota"}</button><button type="button" className="secundario" onClick={clearScan} disabled={saving}>Cancelar revisión</button></div>
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
    {students.length === 0 ? <p className="vacio">Todavía no hay alumnos en el roster.</p> : <div className="omr-table-wrap"><table><thead><tr><th>Alumno</th><th>DNI</th><th>Estado</th><th>Aciertos</th><th>Fallos</th><th>Blancos</th><th>Bruto</th><th>Nota</th><th>Acciones</th></tr></thead><tbody>
      {students.map((student) => <tr key={student.id}><td>{student.name}</td><td>{student.dni}</td><td>{student.savedAt ? student.score === null ? "Puntuación pendiente de validar" : `Corregido · ${new Date(student.savedAt).toLocaleString("es-ES")}` : "Pendiente"}</td><td>{student.correct ?? "—"}</td><td>{student.wrong ?? "—"}</td><td>{student.blank ?? "—"}</td><td>{student.rawScore ?? "—"}</td><td>{student.score ?? "—"}</td><td><div className="fila-acciones">{student.savedAt && <><button type="button" className="secundario" onClick={() => editSaved(student)} disabled={!keyValidated}>Abrir / editar</button><button type="button" className="peligro" onClick={() => void deleteResult(student)}>Eliminar entrega</button></>}<button type="button" className="peligro" onClick={() => void deleteStudent(student)}>Eliminar alumno</button></div></td></tr>)}
    </tbody></table></div>}
    {studentError && !review && <p className="error" role="alert">{studentError}</p>}
  </section>

  <section className="tarjeta" aria-labelledby="offline-queue-heading">
    <h2 id="offline-queue-heading">Cola local de entregas</h2>
    <p className="aviso">Las entregas pendientes persisten en este navegador, están particionadas por cuenta y no están cifradas por la aplicación. No se almacena ninguna imagen. En un dispositivo compartido, elimina la cola antes de cederlo.</p>
    {queueNotice && <p role="status">{queueNotice}</p>}
    <button type="button" className="secundario" onClick={() => void refreshQueue()}>Actualizar cola</button>
    <button type="button" className="peligro" onClick={() => { if (window.confirm("¿Eliminar todas las entregas locales de este examen? No se puede deshacer.")) void purgeQueuedResults(ownerId, { examId }).then(refreshQueue); }}>Purgar cola de este examen</button>
    {queued.filter((entry) => entry.examId === examId).length === 0 ? <p className="vacio">No hay entregas pendientes para este examen.</p> : <ul>{queued.filter((entry) => entry.examId === examId).map((entry) => <li key={entry.id}>
      Alumno {entry.studentId}; {new Date(entry.createdAt).toLocaleString("es-ES")}; {entry.status === "blocked" ? "Requiere revisión" : queueErrorLabel(entry.lastError)}.
      {entry.status === "pending" && <button type="button" className="secundario" onClick={() => void sendQueued(entry, true)}>Reintentar</button>}
      {entry.status === "blocked" && <button type="button" className="secundario" onClick={() => void loadQueuedComparison(entry)}>Comparar respuestas</button>}
      {entry.status === "blocked" && Object.hasOwn(comparisons, entry.id) && comparisons[entry.id] !== undefined && <div className="omr-table-wrap">
        {comparisons[entry.id] ? <>
          <p role="status">Versión actual: {comparisons[entry.id]?.version ?? "desconocida"}. Entrega local creada {new Date(entry.createdAt).toLocaleString("es-ES")}.</p>
          <table><caption>Comparación pregunta a pregunta: cola local frente al servidor</caption><thead><tr><th scope="col">Pregunta</th><th scope="col">Cola local</th><th scope="col">Servidor</th></tr></thead><tbody>
            {Array.from({ length: Math.max(numQuestions, entry.answers.length) }, (_, index) => {
              const questionNo = index + 1;
              const queuedAnswer = entry.answers.find((answer) => answer.questionNo === questionNo);
              const serverAnswer = comparisons[entry.id]?.answers?.find((answer) => answer.questionNo === questionNo);
              return <tr key={questionNo}><th scope="row">{questionNo}</th><td>{optionLabel(queuedAnswer?.optionIndex)}</td><td>{optionLabel(serverAnswer?.optionIndex)}</td></tr>;
            })}
          </tbody></table>
          <button type="button" disabled={!keyValidated} onClick={() => reopenQueuedForReplacement(entry, comparisons[entry.id]!)}>{comparisons[entry.id]?.savedAt ? "Revisar y reemplazar explícitamente" : "Reabrir como nueva entrega"}</button>
        </> : <p role="status">El alumno ya no aparece en el roster. Descarta la entrada local.</p>}
      </div>}
      <button type="button" className="peligro" onClick={() => { if (window.confirm("¿Eliminar definitivamente esta entrega local?")) void deleteQueuedResult(ownerId, entry.id).then(refreshQueue); }}>Eliminar</button>
    </li>)}</ul>}
  </section>
  </>;
}
