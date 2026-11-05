import { z } from "zod";
import { auth } from "@/auth";
import { deepSeekAnswerKeyProvider } from "@/lib/answer-key-provider";
import { generateKeyRequestSchema } from "@/lib/answer-key";
import { findOwnedExam } from "@/lib/exams";
import { readJsonLimited } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RouteContext = { params: Promise<{ examId: string }> };
const idSchema = z.string().uuid();
const MAX_BODY_BYTES = 450_000;

export async function POST(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "No autenticado." }, { status: 401 });

  const { examId } = await context.params;
  const id = idSchema.safeParse(examId);
  if (!id.success) return Response.json({ error: "Examen no encontrado." }, { status: 404 });

  const exam = await findOwnedExam(session.user.id, id.data);
  if (!exam) return Response.json({ error: "Examen no encontrado." }, { status: 404 });

  const input = await readJsonLimited(request, MAX_BODY_BYTES);
  if (input.status === "too_large") {
    return Response.json({ error: "El texto supera el límite de tamaño." }, { status: 413 });
  }
  if (input.status === "invalid") return Response.json({ error: "Solicitud no válida." }, { status: 400 });

  const parsed = generateKeyRequestSchema.safeParse(input.value);
  if (!parsed.success) {
    return Response.json(
      { error: "El texto está vacío o supera el límite de 100.000 caracteres." },
      { status: 400 },
    );
  }

  if (!process.env.DEEPSEEK_API_KEY?.trim()) {
    return Response.json(
      { error: "Falta configurar DEEPSEEK_API_KEY en .env.local y reiniciar la aplicación." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const answers = await deepSeekAnswerKeyProvider.generate(
      parsed.data.text,
      exam.numQuestions,
      exam.numOptions,
    );
    return Response.json({ answers }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const status = code === "DEEPSEEK_AUTH_FAILED" ? 503 : 502;
    const message = code === "DEEPSEEK_AUTH_FAILED"
      ? "DeepSeek rechazó la API key. Revisa DEEPSEEK_API_KEY."
      : code === "DEEPSEEK_INVALID_OUTPUT"
        ? "DeepSeek no devolvió una clave válida tras dos intentos. Puedes introducirla manualmente."
        : "No se pudo generar la clave con DeepSeek. Inténtalo más tarde o introdúcela manualmente.";
    return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
