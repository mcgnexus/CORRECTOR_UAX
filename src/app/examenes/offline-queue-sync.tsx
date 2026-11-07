"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { deleteQueuedResult, listQueuedResults, purgeOwnerQueue, saveQueuedResult, type QueuedResult } from "@/lib/offline-queue/indexed-db";
import { applyQueueDecision, classifyQueueResponse } from "@/lib/offline-queue/queue-state";
import { activeQueueAccount } from "@/lib/offline-queue/account";

export default function OfflineQueueSync({ ownerId }: { ownerId: string }) {
  const [entries, setEntries] = useState<QueuedResult[]>([]);
  const [notice, setNotice] = useState("");
  const lastAutoAttempt = useRef(new Map<string, number>());

  const refresh = useCallback(async () => {
    try { setEntries(await listQueuedResults(ownerId)); }
    catch { setNotice("No se pudo abrir la cola local. Comprueba el espacio del navegador y no cierres esta sesión."); }
  }, [ownerId]);

  const send = useCallback(async (entry: QueuedResult, manual = false) => {
    if (entry.ownerId !== ownerId || entry.status === "blocked") return;
    if (!await activeQueueAccount(ownerId)) {
      setNotice("La cola espera a iniciar sesión con su cuenta original. No se han enviado ni descartado entregas.");
      return;
    }
    if (entry.lastError === "key_pending") {
      try {
        const exam = await fetch(`/api/exams/${entry.examId}`, { headers: { "X-Queue-Owner": ownerId }, cache: "no-store" });
        if (exam.status >= 500) return;
        if (exam.status === 401) {
          await saveQueuedResult({ ...entry, retries: entry.retries + 1, lastError: "unauthorized" });
          await refresh();
          return;
        }
        if (exam.status === 404 || exam.status === 410) {
          await deleteQueuedResult(ownerId, entry.id);
          setNotice("Se descartó una entrega local porque el examen ya no existe.");
          await refresh();
          return;
        }
        if (!exam.ok || ((await exam.json().catch(() => ({})) as { status?: string }).status !== "key_validated")) return;
      } catch {
        setNotice("No se pudo comprobar el estado de la clave; la entrega sigue guardada.");
        return;
      }
    }
    const lastAttempt = lastAutoAttempt.current.get(entry.id) ?? 0;
    if (!manual && Date.now() - lastAttempt < 30_000) return;
    lastAutoAttempt.current.set(entry.id, Date.now());
    try {
      const response = await fetch(`/api/exams/${entry.examId}/results`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": entry.idempotencyKey, "X-Queue-Owner": ownerId },
        body: JSON.stringify({ studentId: entry.studentId, answers: entry.answers, replace: entry.replace, expectedVersion: entry.expectedVersion }),
      });
      const responseBody = await response.json().catch(() => ({})) as { code?: string };
      const decision = classifyQueueResponse(response.status, responseBody.code);
      const next = applyQueueDecision(entry, decision);
      if (decision.action === "ack") {
        await deleteQueuedResult(ownerId, entry.id);
        setNotice("Una entrega local se sincronizó correctamente.");
      } else if (decision.action === "discard") {
        await deleteQueuedResult(ownerId, entry.id);
        setNotice("Se descartó una entrega local porque el examen o alumno ya no existe.");
      } else {
        await saveQueuedResult(next!);
        if (decision.action === "blocked") setNotice("Hay una entrega en conflicto. Ábrela desde el detalle del examen para comparar respuestas.");
      }
    } catch {
      await saveQueuedResult({ ...entry, retries: entry.retries + 1, lastError: "network" }).catch(() => undefined);
    }
    await refresh();
  }, [ownerId, refresh]);

  useEffect(() => { void Promise.resolve().then(refresh); }, [refresh]);

  useEffect(() => {
    const retry = () => {
      if (!navigator.onLine || document.visibilityState !== "visible") return;
      void listQueuedResults(ownerId).then((pending) =>
        pending.filter((entry) => entry.status === "pending").slice(0, 3).forEach((entry) => void send(entry)),
      );
    };
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", retry);
    retry();
    return () => {
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", retry);
    };
  }, [ownerId, send]);

  function label(entry: QueuedResult) {
    if (entry.status === "blocked") {
      return entry.lastError === "version_conflict" ? "Conflicto de versión; requiere comparación" :
        entry.lastError === "exists" ? "Ya existe entrega; requiere comparación" :
          entry.lastError === "idempotency_conflict" ? "Clave idempotente en conflicto" : "Requiere revisión";
    }
    return entry.lastError === "network" ? "Sin conexión; se reintentará" :
      entry.lastError === "server" ? "Error temporal del servidor" :
        entry.lastError === "unauthorized" ? "Espera a iniciar sesión con esta cuenta" :
          entry.lastError === "key_pending" ? "Espera a que se valide la clave" : "Pendiente de sincronización";
  }

  return <section className="tarjeta" aria-labelledby="global-offline-queue-heading">
    <h2 id="global-offline-queue-heading">Cola local de entregas</h2>
    <p className="aviso">La cola persiste en este navegador, está separada por cuenta y no está cifrada por la aplicación. No almacena imágenes. En un dispositivo compartido, purga la cola antes de cederlo.</p>
    {notice && <p role="status">{notice}</p>}
    {entries.length === 0 ? <p className="vacio">No hay entregas locales pendientes.</p> : <ul>
      {entries.map((entry) => <li key={entry.id}>
        Examen {entry.examId}, alumno {entry.studentId}; {new Date(entry.createdAt).toLocaleString("es-ES")}; <span role="status">{label(entry)}.</span>
        {entry.status === "pending" && <button type="button" className="secundario" onClick={() => void send(entry, true)}>Reintentar</button>}
        {entry.status === "blocked" && <Link href={`/examenes/${entry.examId}`}>Comparar en el detalle del examen</Link>}
        <button type="button" className="peligro" onClick={() => {
          if (window.confirm("¿Eliminar definitivamente esta entrega local?")) void deleteQueuedResult(ownerId, entry.id).then(refresh);
        }}>Eliminar</button>
      </li>)}
    </ul>}
    <button type="button" className="secundario" onClick={() => void refresh()}>Actualizar cola local</button>
    {entries.length > 0 && <button type="button" className="peligro" onClick={() => {
      if (window.confirm("¿Purgar todas las entregas locales de esta cuenta en este dispositivo? No se puede deshacer.")) {
        void purgeOwnerQueue(ownerId).then(refresh);
      }
    }}>Purgar cola de esta cuenta</button>}
  </section>;
}
