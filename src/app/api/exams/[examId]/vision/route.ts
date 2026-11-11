import { z } from "zod";
import { auth } from "@/auth";
import { findOwnedExam } from "@/lib/exams";
import { readJsonLimited } from "@/lib/http";
import { deepSeekVision, geminiVision, MAX_VISION_BODY_BYTES, validateVisionRequest } from "@/lib/deepseek-vision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(request: Request, context: { params: Promise<{ examId: string }> }) {
  const headers = { "Cache-Control": "no-store" };
  const fail = (error: string, status: number) => Response.json({ error }, { status, headers });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return fail("Origen no permitido.", 403);
  if (request.headers.get("sec-fetch-site") === "cross-site") return fail("Origen no permitido.", 403);
  if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get("content-type") || "")) return fail("Solicitud no válida.", 415);
  const session = await auth();
  if (!session?.user?.id) return fail("No autenticado.", 401);
  const id = z.string().uuid().safeParse((await context.params).examId);
  if (!id.success) return fail("Examen no encontrado.", 404);
  const exam = await findOwnedExam(session.user.id, id.data);
  if (!exam) return fail("Examen no encontrado.", 404);
  if (exam.sheetFormat !== "uax-grid-40" || exam.numQuestions !== 40 || exam.numOptions !== 4) return fail("El examen no es compatible con la lectura visual.", 422);
  const input = await readJsonLimited(request, MAX_VISION_BODY_BYTES);
  if (input.status === "too_large") return fail("Las imágenes superan el límite de tamaño.", 413);
  if (input.status !== "ok" || !validateVisionRequest(input.value)) return fail("Solicitud o imágenes no válidas.", 400);
  const isGemini = input.value.provider === "gemini";
  if (!(isGemini ? process.env.GEMINI_API_KEY : process.env.DEEPSEEK_API_KEY)?.trim()) return fail("El servicio de visión no está configurado.", 503);
  const started = Date.now();
  try {
    return Response.json({ answers: await (isGemini ? geminiVision : deepSeekVision)(input.value.images) }, { headers });
  } catch (error) {
    const allowed = ["GEMINI_TIMEOUT", "GEMINI_UNAVAILABLE", "GEMINI_REQUEST_FAILED", "GEMINI_INVALID_OUTPUT", "DEEPSEEK_UNAVAILABLE", "DEEPSEEK_REQUEST_FAILED", "DEEPSEEK_INVALID_OUTPUT"];
    const code = error instanceof Error && allowed.includes(error.message) ? error.message : "UNKNOWN";
    console.error({ event: "vision_provider_error", provider: isGemini ? "gemini" : "deepseek", code, durationMs: Date.now() - started });
    return fail("No se pudo leer la hoja. Revisa todas las respuestas manualmente.", 502);
  }
}
