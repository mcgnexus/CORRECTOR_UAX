import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { listOwnedExams } from "@/lib/exams";
import { listDirectoryStudents } from "@/lib/students";
import StudentsClient from "./client";

export const dynamic = "force-dynamic";

export default async function StudentsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const [students, exams] = await Promise.all([listDirectoryStudents(session.user.id), listOwnedExams(session.user.id)]);
  return <>
    <header className="cabecera-app"><h1>Correctora UAX</h1><nav className="fila-acciones" aria-label="Navegación principal"><Link href="/examenes">Exámenes</Link><Link href="/alumnos" aria-current="page">Alumnos</Link><Link href="/cuenta">Mi cuenta</Link></nav></header>
    <main id="main-content" className="contenedor">
      <StudentsClient initialStudents={students.map(({ id, name, dni, email, academicCode, groups, metadata, version }) => ({ id, name, dni, email, academicCode, groups, metadata, version }))} exams={exams.map(({ id, title }) => ({ id, title }))} />
    </main>
  </>;
}
