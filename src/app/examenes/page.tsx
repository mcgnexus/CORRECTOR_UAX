import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { listAccessibleExams } from "@/lib/exams";
import ExamenesClient from "./client";
import OfflineQueueSync from "./offline-queue-sync";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ExamenesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const examenes = await listAccessibleExams(session.user.id);

  async function salir() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <>
      <header className="cabecera-app">
        <h1>Correctora UAX</h1>
        <p className="usuario">{session.user.name ?? session.user.email}{session.user.role === "admin" ? " · Administrador" : ""}</p>
        <nav className="fila-acciones" aria-label="Navegación principal"><Link href="/examenes" aria-current="page">Exámenes</Link><Link href="/alumnos">Alumnos</Link><Link href="/cuenta">Mi cuenta</Link></nav>
        <form action={salir}>
          <button
            type="submit"
            className="secundario"
            style={{ color: "#fff", borderColor: "transparent", padding: "0.15rem 0.5rem", fontSize: "0.85rem" }}
          >
            Salir
          </button>
        </form>
      </header>
      <main id="main-content" className="contenedor">
        <OfflineQueueSync ownerId={session.user.id} />
        <ExamenesClient
          ownerId={session.user.id}
          examenes={examenes.map(({ id, title, subject, numQuestions, numOptions, status }) => ({
            id,
            title,
            subject,
            numQuestions,
            numOptions,
            status,
          }))}
        />
      </main>
    </>
  );
}
