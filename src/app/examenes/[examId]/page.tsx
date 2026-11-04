import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/auth";
import { findOwnedExam } from "@/lib/exams";
import ExamDetalleClient from "./client";

export const dynamic = "force-dynamic";

export default async function ExamenPage({ params }: { params: Promise<{ examId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { examId } = await params;
  const idValido = z.string().uuid().safeParse(examId);
  const examen = idValido.success ? await findOwnedExam(session.user.id, idValido.data) : undefined;
  if (!examen) notFound();

  return (
    <main className="contenedor">
      <ExamDetalleClient
        examen={{
          id: examen.id,
          title: examen.title,
          subject: examen.subject,
          numQuestions: examen.numQuestions,
          numOptions: examen.numOptions,
          status: examen.status,
        }}
      />
    </main>
  );
}
