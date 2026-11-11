import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let userId: string | undefined = "user-1";
let exam: object | null = { sheetFormat: "uax-grid-40", numQuestions: 40, numOptions: 4 };
let ownerRequested = "";
let calls = 0;
let geminiCalls = 0;
for (const [name, exports] of [
  ["@/auth", { auth: async () => userId ? { user: { id: userId } } : null }],
  ["@/lib/exams", { findOwnedExam: async (owner: string) => { ownerRequested = owner; return exam; } }],
  ["@/lib/deepseek-vision", {
    MAX_VISION_BODY_BYTES: 1000,
    validateVisionRequest: (value: unknown) => [undefined, "deepseek", "gemini"].some((provider) => JSON.stringify(value) === JSON.stringify({ consent: true, images: ["first", "second"], ...(provider ? { provider } : {}) })),
    deepSeekVision: async () => { calls++; return [{ questionNo: 1, selectedOption: 0, flag: "ok" }]; },
    geminiVision: async () => { geminiCalls++; return [{ questionNo: 2, selectedOption: 1, flag: "ok" }]; },
  }],
] as const) {
  const id = require.resolve(name);
  require.cache[id] = { id, filename: id, loaded: true, exports, children: [], paths: [] } as unknown as NodeModule;
}
const { POST, maxDuration } = require("./route") as typeof import("./route");

const context = { params: Promise.resolve({ examId: "a2c15cf3-44f9-4ed0-9a6c-b32235e0402b" }) };

test("permite más de 60 segundos para la lectura visual", () => {
  assert.equal(maxDuration, 180);
});

test("rechaza peticiones entre sitios antes de autenticar", async () => {
  const response = await POST(new Request("https://app.example/api/exams/id/vision", {
    method: "POST", headers: { origin: "https://attacker.example", "content-type": "application/json" }, body: "{}",
  }), context);
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("selecciona Gemini explícitamente y comprueba su propia clave", async () => {
  const old = process.env.GEMINI_API_KEY;
  const request = (provider: string) => new Request("https://app.example/api/exams/id/vision", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ consent: true, images: ["first", "second"], provider }),
  });
  try {
    delete process.env.GEMINI_API_KEY;
    assert.equal((await POST(request("gemini"), context)).status, 503);
    assert.equal(geminiCalls, 0);
    process.env.GEMINI_API_KEY = "fake";
    const response = await POST(request("gemini"), context);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { answers: [{ questionNo: 2, selectedOption: 1, flag: "ok" }] });
    assert.equal(geminiCalls, 1);
    assert.equal((await POST(request("otro"), context)).status, 400);
  } finally {
    if (old === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = old;
  }
});

test("rechaza formularios que podrían eludir CORS", async () => {
  const response = await POST(new Request("https://app.example/api/exams/id/vision", {
    method: "POST", headers: { "content-type": "text/plain" }, body: "{}",
  }), context);
  assert.equal(response.status, 415);
});

test("exige sesión, propiedad, formato y consentimiento antes de enviar", async () => {
  const previous = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "fake";
  const request = (body: unknown) => new Request("https://app.example/api/exams/id/vision", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const valid = { consent: true, images: ["first", "second"] };
  try {
    userId = undefined;
    assert.equal((await POST(request(valid), context)).status, 401);
    userId = "user-1";
    exam = null;
    assert.equal((await POST(request(valid), context)).status, 404);
    assert.equal(ownerRequested, "user-1");
    exam = { sheetFormat: "bubbles", numQuestions: 40, numOptions: 4 };
    assert.equal((await POST(request(valid), context)).status, 422);
    exam = { sheetFormat: "uax-grid-40", numQuestions: 40, numOptions: 4 };
    assert.equal((await POST(request({ ...valid, consent: false }), context)).status, 400);
    assert.equal(calls, 0);
    const response = await POST(request(valid), context);
    assert.equal(response.status, 200);
    assert.equal(calls, 1);
    assert.deepEqual(await response.json(), { answers: [{ questionNo: 1, selectedOption: 0, flag: "ok" }] });
  } finally {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = previous;
  }
});
