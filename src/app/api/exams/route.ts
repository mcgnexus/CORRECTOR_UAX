import { auth } from "@/auth";
import { createOwnedExam, listOwnedExams } from "@/lib/exams";
import { examCreateSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "No autenticado." }, { status: 401 });
  return Response.json(await listOwnedExams(session.user.id));
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "No autenticado." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Solicitud no válida." }, { status: 400 });
  }

  const parsed = examCreateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Los datos del examen no son válidos." }, { status: 400 });

  const exam = await createOwnedExam(session.user.id, parsed.data);
  return Response.json(exam, { status: 201 });
}
