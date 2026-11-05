import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/auth";
import { resolveExamAccess } from "@/lib/access";
import { listOwnedAnswerKey } from "@/lib/exam-keys";
import { getOwnedMatrixProfile } from "@/lib/exam-matrix";
import { listOwnedExamRoster } from "@/lib/exam-results";
import { findOwnedExam } from "@/lib/exams";
import { getOwnedScoringRule } from "@/lib/exam-scoring";
import ExamDetalleClient from "./client";

export const dynamic = "force-dynamic";

export default async function ExamenPage({ params }: { params: Promise<{ examId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { examId } = await params;
  const idValido = z.string().uuid().safeParse(examId);
  if (!idValido.success) notFound();
  const access = await resolveExamAccess(session.user.id, idValido.data);
  if (!access) notFound();
  const examen = await findOwnedExam(access.ownerId, idValido.data);
  if (!examen) notFound();
  const [clave, matriz, alumnos, scoring] = await Promise.all([
    listOwnedAnswerKey(access.ownerId, examen.id),
    getOwnedMatrixProfile(access.ownerId, examen.id),
    listOwnedExamRoster(access.ownerId, examen.id),
    getOwnedScoringRule(access.ownerId, examen.id),
  ]);

  return (
    <main id="main-content" className="contenedor">
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
          correct: student.correct,
          wrong: student.wrong,
          blank: student.blank,
          rawScore: student.rawScore,
          score: student.score,
          version: student.version,
        }))}
        scoringRule={scoring!.rule}
        ownerId={session.user.id}
      />
    </main>
  );
}
