import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/auth";
import { listOwnedAnswerKey } from "@/lib/exam-keys";
import { getOwnedMatrixProfile } from "@/lib/exam-matrix";
import { listOwnedExamRoster } from "@/lib/exam-results";
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
  const [clave, matriz, alumnos] = await Promise.all([
    listOwnedAnswerKey(session.user.id, examen.id),
    getOwnedMatrixProfile(session.user.id, examen.id),
    listOwnedExamRoster(session.user.id, examen.id),
  ]);

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
        clave={clave.map((item) => ({
          q: item.questionNo,
          answer: item.correctOption,
          confidence: item.llmConfidence,
          editedByTeacher: item.editedByTeacher,
        }))}
        matrixProfile={
          matriz
            ? {
                bubbles: matriz.bubbles,
                bubbleRadius: matriz.bubbleRadius,
                rowsPerBlock: matriz.rowsPerBlock,
                blocks: matriz.blocks,
                optionsPerBlock: matriz.optionsPerBlock,
                updatedAt: matriz.updatedAt.toISOString(),
              }
            : null
        }
        students={alumnos.map((student) => ({
          id: student.id,
          name: student.name,
          dni: student.dni,
          savedAt: student.savedAt?.toISOString() ?? null,
          answers: student.answers,
        }))}
      />
    </main>
  );
}
