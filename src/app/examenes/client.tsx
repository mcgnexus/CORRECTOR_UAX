"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { purgeOwnerQueue, purgeQueuedResults } from "@/lib/offline-queue/indexed-db";
import PasswordInput from "../password-input";

type Exam = {
  id: string;
  title: string;
  subject: string | null;
  numQuestions: number;
  numOptions: number;
  status: "draft" | "key_pending" | "key_validated";
};

const ETIQUETAS_ESTADO: Record<Exam["status"], string> = {
  draft: "Borrador",
  key_pending: "Clave pendiente",
  key_validated: "Clave validada",
};

export default function ExamenesClient({ examenes, ownerId }: { examenes: Exam[]; ownerId: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [accountDeleted, setAccountDeleted] = useState(false);

  async function finishAccountRemoval() {
    try {
      await purgeOwnerQueue(ownerId);
      await signOut({ callbackUrl: "/login" });
    } catch {
      setAccountError("La cuenta ya se eliminó del servidor, pero la cola local no pudo purgarse. Mantén este dispositivo y reintenta la purga antes de cederlo.");
    }
  }

  async function crear(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setEnviando(true);
    const formulario = event.currentTarget;
    const datos = Object.fromEntries(new FormData(formulario));
    const respuesta = await fetch("/api/exams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(datos),
    });
    setEnviando(false);
    if (!respuesta.ok) {
      const cuerpo = (await respuesta.json().catch(() => ({}))) as { error?: string };
      setError(cuerpo.error ?? "No se pudo crear el examen. Revisa los valores.");
      return;
    }
    formulario.reset();
    router.refresh();
  }

  async function eliminar(id: string) {
    if (!window.confirm("¿Eliminar este examen y todos sus datos? Esta acción no se puede deshacer.")) return;
    const respuesta = await fetch(`/api/exams/${id}`, { method: "DELETE" });
    if (respuesta.ok) {
      await purgeQueuedResults(ownerId, { examId: id });
      router.refresh();
    }
  }

  async function eliminarCuenta(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!window.confirm("Se eliminarán permanentemente la cuenta y todos sus exámenes, alumnos y resultados. Esta acción es irreversible.")) return;
    setDeletingAccount(true);
    setAccountError("");
    try {
      const values = new FormData(event.currentTarget);
      const response = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: values.get("account-password"), confirmation: values.get("account-confirmation") }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        setAccountError(data.error ?? "No se pudo eliminar la cuenta.");
        return;
      }
      setAccountDeleted(true);
      await finishAccountRemoval();
    } catch {
      setAccountError("No se pudo confirmar la operación. Comprueba el estado de la cuenta y purga su cola local antes de ceder este dispositivo.");
    } finally {
      setDeletingAccount(false);
    }
  }

  return (
    <>
      <div className="tarjeta">
        <h2>Nuevo examen</h2>
        <form onSubmit={crear}>
          <label htmlFor="title">Título</label>
          <input id="title" name="title" required maxLength={160} placeholder="Parcial 1 — Tema 1-3" />
          <label htmlFor="subject">Asignatura (opcional)</label>
          <input id="subject" name="subject" maxLength={160} placeholder="Gestión y Base de Datos" />
          <label htmlFor="numQuestions">Número de preguntas (1–100)</label>
          <input id="numQuestions" name="numQuestions" type="number" min={1} max={100} defaultValue={40} required />
          <label htmlFor="numOptions">Opciones por pregunta (2–26)</label>
          <input id="numOptions" name="numOptions" type="number" min={2} max={26} defaultValue={4} required />
          {error ? <p className="error" role="alert">{error}</p> : null}
          <div style={{ marginTop: "0.75rem" }}>
            <button type="submit" disabled={enviando}>
              {enviando ? "Creando…" : "Crear examen"}
            </button>
          </div>
        </form>
      </div>

      <div className="tarjeta">
        <h2>Mis exámenes</h2>
        {examenes.length === 0 ? (
          <p className="vacio">Aún no tienes exámenes. Crea el primero arriba.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Título</th>
                <th>Preguntas</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {examenes.map((examen) => (
                <tr key={examen.id}>
                  <td>
                    <Link href={`/examenes/${examen.id}`}>{examen.title}</Link>
                    {examen.subject ? (
                      <>
                        <br />
                        <span className="vacio">{examen.subject}</span>
                      </>
                    ) : null}
                  </td>
                  <td>
                    {examen.numQuestions} × {examen.numOptions}
                  </td>
                  <td>
                    <span className={`estado ${examen.status}`}>{ETIQUETAS_ESTADO[examen.status]}</span>
                  </td>
                  <td>
                    <button type="button" className="peligro" onClick={() => eliminar(examen.id)}>
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <section className="tarjeta" aria-labelledby="delete-account-heading">
        <h2 id="delete-account-heading">Zona de peligro: eliminar cuenta</h2>
        <p className="aviso">El borrado elimina los datos activos de la cuenta. En este dispositivo también se purgará la cola offline. Otros dispositivos desconectados no pueden borrarse remotamente; al reconectarlos, elimina manualmente sus datos locales. Los backups del proveedor pueden persistir hasta su expiración.</p>
        {accountDeleted ? <div>
          <p role="alert">{accountError || "La cuenta fue eliminada."}</p>
          <button type="button" className="peligro" onClick={() => void finishAccountRemoval()}>Reintentar purga local y cerrar sesión</button>
        </div> : <form onSubmit={eliminarCuenta}>
          <PasswordInput id="account-password" name="account-password" label="Contraseña actual" autoComplete="current-password" required />
          <label htmlFor="account-confirmation">Escribe ELIMINAR CUENTA para confirmar</label>
          <input id="account-confirmation" name="account-confirmation" required pattern="ELIMINAR CUENTA" />
          {accountError && <p className="error" role="alert">{accountError}</p>}
          <button type="submit" className="peligro" disabled={deletingAccount}>{deletingAccount ? "Eliminando cuenta…" : "Eliminar cuenta permanentemente"}</button>
        </form>}
      </section>
    </>
  );
}
