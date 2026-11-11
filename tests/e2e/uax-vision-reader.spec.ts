import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import path from "node:path";
import type { build as Esbuild } from "esbuild";

const require = createRequire(path.resolve("package.json"));
const { build } = createRequire(require.resolve("tsx"))("esbuild") as { build: typeof Esbuild };

test("visión sin calibración mantiene pendientes las respuestas ambiguas y protege la revisión", async ({ page }) => {
  const output = await build({
    stdin: {
      contents: `import React, {useState} from 'react';
        import {createRoot} from 'react-dom/client';
        import OmrReader from './src/app/examenes/[examId]/omr-reader';
        function App() {
          const [students, setStudents] = useState([{id:'student',name:'Alumno',dni:null,savedAt:null,answers:null,correct:null,wrong:null,blank:null,rawScore:null,score:null,version:null}]);
          return <OmrReader sheetFormat="uax-grid-40" examId="test-exam" ownerId="test-owner" structureVersion={1} numQuestions={40} numOptions={4} profile={null} initialStudents={students} onStudentsChange={setStudents} keyValidated={true} onKeyPending={()=>{}}/>;
        }
        createRoot(document.getElementById('root')).render(<App/>);`,
      resolveDir: process.cwd(), loader: "tsx",
    },
    bundle: true, write: false, platform: "browser", format: "esm", jsx: "automatic",
    alias: { "@": path.resolve("src") },
    plugins: [{ name: "next-link", setup(builder) {
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "import React from 'react'; export default function Link(props) { return React.createElement('a', props); }", resolveDir: process.cwd() }));
    } }],
  });
  let requests = 0;
  let payload: { consent: boolean; images: string[]; provider: string } | undefined;
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== "https://vision-reader.test") throw new Error(`Red externa prohibida: ${url.href}`);
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: '<div id="root"></div><script type="module" src="/fixture.js"></script>' });
    if (url.pathname === "/fixture.js") return route.fulfill({ contentType: "text/javascript", body: output.outputFiles[0].text });
    if (url.pathname === "/api/exams/test-exam/vision" && route.request().method() === "POST") {
      requests++;
      payload = route.request().postDataJSON();
      if (requests === 1) return route.fulfill({ status: 504, contentType: "text/plain", body: "Gateway Timeout" });
      if (requests === 2) return route.fulfill({ status: 400, json: { error: "Error de visión de prueba" } });
      return route.fulfill({ json: { answers: Array.from({ length: 40 }, (_, i) => ({ questionNo: i + 1, selectedOption: i < 2 ? null : 0, flag: i === 0 ? "multiple" : i === 1 ? "faint" : "ok" })) } });
    }
    throw new Error(`Petición inesperada: ${route.request().method()} ${url.pathname}`);
  });
  await page.goto("https://vision-reader.test/");
  await expect(page.getByText("Primero calibra la matriz de este examen.")).toBeVisible();
  await page.getByLabel("Método de lectura").selectOption("gemini");
  await expect(page.getByLabel("Elegir imagen")).toBeEnabled();
  const image = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 800; canvas.height = 1000;
    const ctx = canvas.getContext("2d")!; ctx.fillStyle = "white"; ctx.fillRect(0, 0, 800, 1000);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.locator("#omr-image").setInputFiles({ name: "hoja.png", mimeType: "image/png", buffer: Buffer.from(image, "base64") });
  const send = page.getByRole("button", { name: "Enviar recortes" });
  await expect(send).toBeDisabled();
  for (const [label, values] of [["izquierda", [10, 100, 300, 700]], ["derecha", [400, 100, 300, 700]]] as const) {
    const group = page.getByRole("group", { name: new RegExp(label) });
    for (const [index, name] of ["X", "Y", "Ancho", "Alto"].entries()) await group.getByLabel(name, { exact: true }).fill(String(values[index]));
    await group.getByRole("button", { name: "Aplicar coordenadas" }).click();
  }
  await page.getByRole("button", { name: "Preparar vista previa" }).click();
  const previews = page.locator('img[alt^="Recorte"]');
  await expect(previews).toHaveCount(2);
  const images = await previews.evaluateAll(nodes => nodes.map(node => (node as HTMLImageElement).src));
  await expect(send).toBeDisabled();
  expect(requests).toBe(0);
  await page.getByRole("checkbox", { name: /consiento su envío a Gemini/ }).check();
  await send.click();
  await expect.poll(() => requests).toBe(1);
  await expect(page.getByRole("alert")).toContainText("No se pudo analizar la imagen con Gemini.");
  await expect(page.getByRole("alert")).not.toContainText("SyntaxError");
  await page.getByRole("checkbox", { name: /consiento su envío a Gemini/ }).check();
  await send.click();
  await expect(page.getByRole("alert")).toContainText("Error de visión de prueba");
  await page.getByRole("checkbox", { name: /consiento su envío a Gemini/ }).check();
  await send.click();
  await expect.poll(() => requests).toBe(3);
  expect(payload).toEqual({ consent: true, images, provider: "gemini" });
  const rows = page.locator(".omr-review tbody tr");
  await expect(rows).toHaveCount(40);
  await expect(page.locator(".omr-review tbody button", { hasText: "Confirmar" })).toHaveCount(40);
  await page.getByLabel("Alumno del roster").selectOption("student");
  const save = page.getByRole("button", { name: "Confirmar entrega y nota" });
  await expect(save).toBeDisabled();
  await page.getByRole("button", { name: "Confirmar todas las respuestas" }).click();
  for (const question of [1, 2]) {
    await expect(page.getByLabel(`Respuesta final pregunta ${question}`, { exact: true })).toHaveValue("unresolved");
    await expect(rows.nth(question - 1).getByRole("button", { name: "Confirmar" })).toBeDisabled();
  }
  await expect(save).toBeDisabled();
  await page.getByLabel("Respuesta final pregunta 1", { exact: true }).selectOption("1");
  await rows.nth(0).getByRole("button", { name: "Confirmar" }).click();
  await expect(save).toBeDisabled();
  await page.getByLabel("Respuesta final pregunta 2", { exact: true }).selectOption("blank");
  await rows.nth(1).getByRole("button", { name: "Confirmar" }).click();
  await expect(save).toBeEnabled();
  page.once("dialog", dialog => { expect(dialog.message()).toContain("sustituirá la revisión actual"); void dialog.dismiss(); });
  await page.getByRole("button", { name: "Seleccionar tablas para Gemini" }).click();
  await expect(rows).toHaveCount(40);
  await expect(page.getByLabel("Respuesta final pregunta 1", { exact: true })).toHaveValue("1");
  page.once("dialog", dialog => { expect(dialog.message()).toContain("sustituirá la revisión actual"); void dialog.accept(); });
  await page.getByRole("button", { name: "Seleccionar tablas para Gemini" }).click();
  await expect(rows).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Selecciona las dos tablas" })).toBeVisible();
  expect(requests).toBe(3);
});
