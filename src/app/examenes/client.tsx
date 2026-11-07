"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { purgeOwnerQueue, purgeQueuedResults } from "@/lib/offline-queue/indexed-db";
import PasswordInput from "../password-input";
import { examDemo } from "@/lib/exam-demo-content";

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
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [demoError, setDemoError] = useState("");
  const demoPendingRef = useRef(false);

  async function loadDemo() {
    if (demoPendingRef.current) return;
    if (!window.confirm("Se creará un ejemplo ficticio privado con tres fichas de alumnos, inscripciones y respuestas de prueba. No se enviará nada a IA. Si ya tienes un ejemplo, se abrirá sin duplicarlo. ¿Continuar?")) return;
    demoPendingRef.current = true;
    setLoadingDemo(true);
    setDemoError("");
    try {
      const response = await fetch("/api/exams/demo", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "CREAR EJEMPLO FICTICIO" }) });
      const body = await response.json().catch(() => ({})) as { examId?: string; error?: string };
      if (!response.ok || !body.examId) {
        setDemoError(body.error ?? "No se pudo cargar el ejemplo. Reintentar no creará otra copia.");
        return;
      }
      router.push(`/examenes/${body.examId}`);
      router.refresh();
    } catch {
      setDemoError("No se pudo conectar. Reintentar abrirá el mismo ejemplo si ya se creó.");
    } finally {
      demoPendingRef.current = false;
      setLoadingDemo(false);
    }
  }

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

      <section className="tarjeta" aria-labelledby="demo-heading">
        <h2 id="demo-heading">Ejemplo ficticio privado</h2>
        <p>Prueba un examen de cuatro preguntas con tres alumnos ficticios, una clave manual revisable y dos entregas pendientes de puntuar. Revisa y valida la clave para calcular sus notas; después puedes introducir las respuestas del alumno pendiente sin fotografía.</p>
        <p>Solo se mantiene un ejemplo por cuenta. Puedes eliminar el examen y las fichas de prueba con las acciones habituales. Cargarlo nunca llama a IA ni presenta la clave manual como generada por IA.</p>
        <button type="button" className="secundario" disabled={loadingDemo} onClick={() => void loadDemo()}>{loadingDemo ? "Cargando ejemplo…" : "Cargar ejemplo"}</button>
        {demoError && <p className="error" role="alert">{demoError}</p>}
        <details>
          <summary>Texto ficticio para probar la propuesta IA</summary>
          <p>Este texto no contiene datos reales. Para probar IA, introdúcelo en la opción de propuesta IA del examen y otorga allí el consentimiento de envío. Revisa la propuesta y valida la clave por separado. No se envía al abrir este panel.</p>
          <pre aria-label="Texto ficticio del ejemplo" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{examDemo.aiText}</pre>
        </details>
      </section>

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
