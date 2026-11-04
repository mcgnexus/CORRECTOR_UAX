import assert from "node:assert/strict";
import test from "node:test";
import { createDeepSeekAnswerKeyProvider } from "@/lib/answer-key-provider";

test("reintenta una sola vez si DeepSeek devuelve JSON vacío y valida el resultado", async () => {
  const previousKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "test-key-no-real";
  let calls = 0;
  const provider = createDeepSeekAnswerKeyProvider(async (_input, init) => {
    calls += 1;
    const request = JSON.parse(String(init?.body)) as { model: string; response_format: { type: string } };
    assert.equal(request.model, "deepseek-flash");
    assert.equal(request.response_format.type, "json_object");
    const content = calls === 1
      ? "   "
      : JSON.stringify({ answers: [{ q: 1, answer: "B", confidence: 0.91 }] });
    return Response.json({ choices: [{ finish_reason: "stop", message: { content } }] });
  });

  try {
    const result = await provider.generate("Texto de examen simulado", 1, 4);
    assert.equal(calls, 2);
    assert.deepEqual(result, [{ q: 1, answer: "B", confidence: 0.91 }]);
  } finally {
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
  }
});

test("detiene después de dos respuestas inválidas sin devolver su contenido", async () => {
  const previousKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "test-key-no-real";
  let calls = 0;
  const provider = createDeepSeekAnswerKeyProvider(async () => {
    calls += 1;
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: "no es una clave" } }] });
  });

  try {
    await assert.rejects(provider.generate("Texto simulado", 1, 4), { message: "DEEPSEEK_INVALID_OUTPUT" });
    assert.equal(calls, 2);
  } finally {
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
  }
});
