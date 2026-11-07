import { z } from "zod";
import { auth } from "@/auth";
import { readJsonLimited } from "@/lib/http";
import { assignDirectoryStudents } from "@/lib/students";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "No autorizado." }, { status: 401 });
  const body = await readJsonLimited(request, 50_000);
  const parsed = body.status === "ok" ? z.object({ examId: z.string().uuid(), studentIds: z.array(z.string().uuid()).min(1).max(1000) }).strict().safeParse(body.value) : null;
  if (!parsed?.success) return Response.json({ error: "Selecciona un examen y alumnos válidos." }, { status: 400 });
  const result = await assignDirectoryStudents(session.user.id, parsed.data.examId, parsed.data.studentIds);
  if (result.status === "not_found") return Response.json({ error: "Examen o alumnos no encontrados." }, { status: 404 });
  if (result.status === "invalid" || result.status === "conflict") return Response.json({ error: result.message }, { status: result.status === "conflict" ? 409 : 400 });
  return Response.json({ count: result.count });
}
