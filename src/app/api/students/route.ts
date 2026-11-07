import { auth } from "@/auth";
import { readJsonLimited } from "@/lib/http";
import { createDirectoryStudent, listDirectoryStudents } from "@/lib/students";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "No autorizado." }, { status: 401 });
  return Response.json({ students: await listDirectoryStudents(session.user.id) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "No autorizado." }, { status: 401 });
  const body = await readJsonLimited(request, 40_000);
  if (body.status !== "ok") return Response.json({ error: "Datos no válidos o demasiado grandes." }, { status: body.status === "too_large" ? 413 : 400 });
  const result = await createDirectoryStudent(session.user.id, body.value);
  if (result.status === "invalid") return Response.json({ error: result.message }, { status: 400 });
  if (result.status === "duplicate") return Response.json({ error: "El DNI o código académico ya existe en tu base de alumnos." }, { status: 409 });
  if (result.status === "not_found") return Response.json({ error: "No autorizado." }, { status: 401 });
  return Response.json({ student: result.student }, { status: 201 });
}
