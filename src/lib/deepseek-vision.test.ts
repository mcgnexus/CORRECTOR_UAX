import assert from "node:assert/strict";
import test from "node:test";
import { createDeepSeekVisionProvider, parseVisionAnswers, validateVisionRequest } from "@/lib/deepseek-vision";

const png = `data:image/png;base64,${Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64")}`;
const jpeg = `data:image/jpeg;base64,${Buffer.from([255, 216, 255, 217]).toString("base64")}`;
const answers = Array.from({ length: 40 }, (_, index) => ({ questionNo: index + 1, selectedOption: 0, flag: "ok" }));

test("valida consentimiento y dos imágenes base64 canónicas con firma correcta", () => {
  assert.equal(validateVisionRequest({ consent: true, images: [png, jpeg] }), true);
  for (const input of [
    { consent: false, images: [png, jpeg] },
    { consent: true, images: [png] },
    { consent: true, images: [png, "https://example.com/a.png"] },
    { consent: true, images: [png, jpeg.replace("image/jpeg", "image/png")] },
    { consent: true, images: [png, `${jpeg} `] },
    { consent: true, images: [png, `data:image/png;base64,${"A".repeat(5_600_000)}`] },
    { consent: true, images: [png, jpeg], url: "https://example.com" },
  ]) assert.equal(validateVisionRequest(input), false);
});

test("exige cuarenta respuestas inequívocas y coherentes", () => {
  assert.deepEqual(parseVisionAnswers(JSON.stringify({ answers })), answers);
  for (const invalid of [
    answers.slice(1),
    answers.map((a, i) => i === 1 ? { ...a, questionNo: 1 } : a),
    answers.map((a, i) => i === 1 ? { ...a, selectedOption: 4 } : a),
    answers.map((a, i) => i === 1 ? { ...a, flag: "blank" } : a),
    answers.map((a, i) => i === 1 ? { ...a, selectedOption: null } : a),
    answers.map((a, i) => i === 1 ? { ...a, flag: "faint", selectedOption: 2 } : a),
  ]) assert.throws(() => parseVisionAnswers(JSON.stringify({ answers: invalid })));
  assert.throws(() => parseVisionAnswers("```json\n{}\n```"));
});

test("envía imágenes solo al endpoint oficial y valida la respuesta", async () => {
  const old = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "fake";
  try {
    const provider = createDeepSeekVisionProvider(async (url, init) => {
      assert.equal(url, "https://api.deepseek.com/chat/completions");
      assert.equal(init?.redirect, "error");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, process.env.DEEPSEEK_VISION_MODEL?.trim() || "deepseek-flash");
      assert.deepEqual(body.messages[1].content.filter((part: { type: string }) => part.type === "image_url").map((part: { image_url: { url: string } }) => part.image_url.url), [png, jpeg]);
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ answers }) } }] });
    });
    assert.deepEqual(await provider([png, jpeg]), answers);
    const invalid = createDeepSeekVisionProvider(async () => Response.json({ choices: [{ finish_reason: "length", message: { content: JSON.stringify({ answers }) } }] }));
    await assert.rejects(invalid([png, jpeg]), { message: "DEEPSEEK_INVALID_OUTPUT" });
    const failure = createDeepSeekVisionProvider(async () => { throw new Error("private image or key"); });
    await assert.rejects(failure([png, jpeg]), { message: "DEEPSEEK_UNAVAILABLE" });
  } finally {
    if (old === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = old;
  }
});
