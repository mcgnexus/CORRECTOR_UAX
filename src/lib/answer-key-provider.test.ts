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

test("emite telemetría allowlist sin texto, secretos ni contenido de respuesta", async () => {
  const previousKey = process.env.DEEPSEEK_API_KEY;
  const previousError = console.error;
  process.env.DEEPSEEK_API_KEY = "fake-secret-token";
  const events: string[] = [];
  console.error = (event) => events.push(String(event));
  const provider = createDeepSeekAnswerKeyProvider(async () => new Response("respuesta privada", { status: 502 }));

  try {
    await assert.rejects(provider.generate("EXAM_PRIVATE_TEXT DNI_PRIVATE", 1, 4), { message: "DEEPSEEK_REQUEST_FAILED" });
    assert.equal(events.length, 1);
    const event = JSON.parse(events[0]) as Record<string, unknown>;
    assert.deepEqual(Object.keys(event).sort(), ["attempts", "code", "durationMs", "eventId", "status"].sort());
    assert.equal(event.code, "DEEPSEEK_REQUEST_FAILED");
    assert.equal(event.status, 502);
    assert.equal(event.attempts, 1);
    assert.equal(typeof event.eventId, "string");
    assert.equal(typeof event.durationMs, "number");
    assert.doesNotMatch(events[0], /EXAM_PRIVATE_TEXT|DNI_PRIVATE|fake-secret-token|respuesta privada/);
  } finally {
    console.error = previousError;
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
  }
});

test("el endpoint simulado solo permite loopback y no sigue redirects en modo Playwright", async () => {
  const previous = {
    key: process.env.DEEPSEEK_API_KEY,
    playwright: process.env.PLAYWRIGHT_TEST,
    endpoint: process.env.DEEPSEEK_TEST_ENDPOINT,
  };
  process.env.DEEPSEEK_API_KEY = "fake-key";
  process.env.PLAYWRIGHT_TEST = "1";
  process.env.DEEPSEEK_TEST_ENDPOINT = "https://example.com/chat/completions";
  let calls = 0;
  const previousError = console.error;
  console.error = () => undefined;
  const provider = createDeepSeekAnswerKeyProvider(async () => { calls += 1; return Response.json({}); });
  try {
    await assert.rejects(provider.generate("Texto sintético", 1, 4), { message: "DEEPSEEK_UNAVAILABLE" });
    assert.equal(calls, 0);
  } finally {
    console.error = previousError;
    if (previous.key === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = previous.key;
    if (previous.playwright === undefined) delete process.env.PLAYWRIGHT_TEST; else process.env.PLAYWRIGHT_TEST = previous.playwright;
    if (previous.endpoint === undefined) delete process.env.DEEPSEEK_TEST_ENDPOINT; else process.env.DEEPSEEK_TEST_ENDPOINT = previous.endpoint;
  }
});
