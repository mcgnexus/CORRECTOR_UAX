import assert from "node:assert/strict";
import test from "node:test";
import { readJsonLimited } from "@/lib/http";

test("lee JSON dentro del límite", async () => {
  const request = new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "examen" }),
  });
  assert.deepEqual(await readJsonLimited(request, 100), { status: "ok", value: { text: "examen" } });
});

test("rechaza cuerpos mayores al límite aunque no anuncien content-length", async () => {
  const request = new Request("http://localhost/api", {
    method: "POST",
    body: JSON.stringify({ text: "x".repeat(500) }),
  });
  assert.deepEqual(await readJsonLimited(request, 100), { status: "too_large" });
});

test("rechaza JSON malformado", async () => {
  const request = new Request("http://localhost/api", { method: "POST", body: "{" });
  assert.deepEqual(await readJsonLimited(request, 100), { status: "invalid" });
});
