import { expect, test, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import path from "node:path";
import { readFileSync } from "node:fs";
import type { build as Esbuild } from "esbuild";

const localRequire = createRequire(path.resolve("package.json"));
const { build } = createRequire(localRequire.resolve("tsx"))("esbuild") as { build: typeof Esbuild };
const studentId = "00000000-0000-4000-8000-000000000003";
const examId = "00000000-0000-4000-8000-000000000002";
const pendingId = "00000000-0000-4000-8000-000000000004";
let script: string;
const styles = readFileSync(path.resolve("src/app/globals.css"), "utf8");

test.beforeAll(async () => {
  const output = await build({
    stdin: {
      contents: `import React, {useState} from 'react';
        import {createRoot} from 'react-dom/client';
        import OmrReader from './src/app/examenes/[examId]/omr-reader';
        import {saveQueuedResult, listQueuedResults} from './src/lib/offline-queue/indexed-db';
        window.testQueue = {saveQueuedResult, listQueuedResults};
        const saved = {id: '${studentId}', name: 'Alumno corregido', dni: 'legacy-invalid',
          savedAt: '2026-01-01T12:00:00Z', answers: [{questionNo:1,optionIndex:0}],
          correct: 1, wrong: 2, blank: 1, rawScore: '1', score: '2.5', version: 7};
        function App() {
          const [students, setStudents] = useState([saved, {...saved, id:'${pendingId}',
            name:'Alumno pendiente', dni:'00000000T', savedAt:null, answers:null,
            correct:null, wrong:null, blank:null, rawScore:null, score:null, version:null}]);
          return <OmrReader examId='${examId}' ownerId='00000000-0000-4000-8000-000000000001'
            numQuestions={4} numOptions={4} profile={{bubbles:[],bubbleRadius:0.012}}
            initialStudents={students} onStudentsChange={setStudents} keyValidated={true} onKeyPending={()=>{}}/>;
        }
        createRoot(document.getElementById('root')).render(<App/>);`,
      resolveDir: process.cwd(), loader: "tsx",
    },
    bundle: true, write: false, platform: "browser", format: "esm", jsx: "automatic",
    alias: { "@": path.resolve("src") },
    plugins: [{ name: "next-link-only", setup(builder) {
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
        contents: "import React from 'react'; export default function Link(props) { return React.createElement('a', props); }",
        resolveDir: process.cwd(),
      }));
    } }],
  });
  script = output.outputFiles[0].text;
});

async function mount(page: Page) {
  await page.addInitScript(() => {
    // Exact boundary values are injected at the worker boundary, not into React state.
    window.Worker = class {
      onmessage: ((event: MessageEvent) => void) | null = null;
      postMessage() {
        setTimeout(() => this.onmessage?.({ data: { type: "result", result: { markers: [], answers: [
          { q: 1, detected: 0, confidence: 0.899, flag: "faint" },
          { q: 2, detected: null, confidence: 0.9, flag: "blank" },
          { q: 3, detected: 1, confidence: 0.901, flag: "multiple" },
          { q: 4, detected: 2, confidence: null, flag: "ok" },
        ] } } } as MessageEvent), 0);
      }
      terminate() {}
    } as unknown as typeof Worker;
  });
  await page.route("https://student-review.test/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/fixture.js") return route.fulfill({ contentType: "text/javascript", body: script });
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: `<html lang="es"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Student review fixture</title><style>${styles}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>` });
    throw new Error(`Peticion inesperada: ${route.request().method()} ${url.pathname}`);
  });
  await page.goto("https://student-review.test/");
  await expect(page.getByRole("button", { name: "Editar datos", exact: true })).toHaveCount(2);
}

async function scan(page: Page) {
  // Same local synthetic sheet geometry as hardening.spec.ts; no personal image.
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 900; canvas.height = 1200;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "white"; ctx.fillRect(0, 0, 900, 1200);
    ctx.fillStyle = "black";
    for (const [x, y] of [[60, 60], [840, 60], [60, 1140], [840, 1140]]) ctx.fillRect(x - 6, y - 6, 13, 13);
    return canvas.toDataURL();
  });
  await page.locator("#omr-image").setInputFiles({ name: "synthetic.png", mimeType: "image/png", buffer: Buffer.from(dataUrl.split(",")[1], "base64") });
  await expect(page.getByRole("status").filter({ hasText: "Lectura provisional terminada" })).toBeVisible();
}

test("@mobile umbral exacto, confianza ausente y banderas sobreviven a confirmar", async ({ page }) => {
  await mount(page);
  await scan(page);
  const rows = page.getByRole("region", { name: "Revisión de respuestas, tabla desplazable" }).locator("tbody tr");
  for (const confirmed of [false, true]) {
    if (confirmed) await page.getByRole("button", { name: "Confirmar todas las respuestas" }).click();
    for (const [i, percentage] of ["89.9%", "90%", "90.1%", "—"].entries()) {
      await expect(rows.nth(i).locator("td").nth(2)).toContainText(percentage);
      await expect(rows.nth(i)).toHaveClass(i === 0 ? /omr-low-confidence/ : /^(?!.*omr-low-confidence)/);
      await expect(rows.nth(i)).toHaveClass(confirmed ? /^(?!.*omr-pending)/ : /omr-pending/);
    }
    await expect(rows.getByText("Confianza baja", { exact: true })).toHaveCount(1);
    await expect(rows.nth(0).locator("td").nth(2)).toHaveCSS("background-color", "rgb(238, 229, 255)");
    await expect(rows.nth(0).locator("td").nth(2)).toHaveCSS("color", "rgb(73, 33, 122)");
    for (const [i, flag, label] of [[0, "faint", "Dudosa"], [1, "blank", "En blanco"], [2, "multiple", "Varias marcas"]] as const) {
      await expect(rows.nth(i)).toHaveClass(new RegExp(`omr-${flag}`));
      await expect(rows.nth(i).locator("td").nth(1)).toContainText(label);
    }
  }
  await expect(page.getByText("Confirmada", { exact: true })).toHaveCount(4);
});

for (const saved of [false, true]) {
  test(`@mobile editar alumno ${saved ? "corregido" : "pendiente"} conserva imagen y revision`, async ({ page }) => {
    await mount(page);
    await scan(page);
    const id = saved ? studentId : pendingId;
    await page.locator("#omr-student").selectOption(id);
    await page.getByLabel("Respuesta final pregunta 1").selectOption("3");
    await page.getByRole("button", { name: "Confirmar", exact: true }).first().click();
    const canvas = page.locator("canvas.omr-preview");
    const pixels = await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL());
    const review = page.getByRole("region", { name: "Revisión de respuestas, tabla desplazable" });
    const before = await review.innerHTML();
    const queueBefore = await page.evaluate(async ({ id, examId }) => {
      const queue = (window as unknown as { testQueue: typeof import("../../src/lib/offline-queue/indexed-db") }).testQueue;
      const key = "00000000-0000-4000-8000-000000000005";
      await queue.saveQueuedResult({ id: key, idempotencyKey: key, ownerId: "00000000-0000-4000-8000-000000000001", examId, studentId: id, answers: [{ questionNo: 1, optionIndex: 3 }], replace: false, expectedVersion: null, createdAt: "2026-01-01T12:00:00Z", status: "pending", retries: 2, lastError: "network" });
      return queue.listQueuedResults("00000000-0000-4000-8000-000000000001");
    }, { id, examId });
    const row = page.getByRole("row").filter({ hasText: saved ? "Alumno corregido" : "Alumno pendiente" });
    if (saved) await expect(row.getByText("Documento antiguo no válido; edita los datos para corregirlo.", { exact: true })).toBeVisible();
    const cells = await row.locator("td").allTextContents();
    const bodies: unknown[] = [];
    await page.route(`**/api/exams/${examId}/students/${id}`, async (route) => {
      expect(route.request().method()).toBe("PATCH");
      bodies.push(route.request().postDataJSON());
      await route.fulfill({ json: { student: { id, name: "Alumno actualizado", dni: "87654321X" } } });
    });
    await row.getByRole("button", { name: "Editar datos", exact: true }).click();
    const form = page.getByRole("form", { name: /Editar datos de/ });
    await expect(form.getByLabel("Nombre completo")).toBeFocused();
    await form.getByLabel("Nombre completo").fill("Alumno actualizado");
    await form.getByLabel("DNI/NIE").fill("87654321x");
    await page.keyboard.press("Tab");
    await expect(form.getByRole("button", { name: "Guardar datos", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(form).toHaveCount(0);
    expect(bodies).toEqual([{ name: "Alumno actualizado", dni: "87654321X", originalName: saved ? "Alumno corregido" : "Alumno pendiente", originalDni: saved ? "legacy-invalid" : "00000000T" }]);
    await expect(page.locator("#omr-student")).toHaveValue(id);
    expect(await review.innerHTML()).toBe(before);
    expect(await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL())).toBe(pixels);
    expect(await page.evaluate(() => (window as unknown as { testQueue: typeof import("../../src/lib/offline-queue/indexed-db") }).testQueue.listQueuedResults("00000000-0000-4000-8000-000000000001"))).toEqual(queueBefore);
    const updated = page.getByRole("row").filter({ hasText: "Alumno actualizado" });
    expect((await updated.locator("td").allTextContents()).slice(2)).toEqual(cells.slice(2));
    await expect(updated.getByRole("button", { name: "Editar datos", exact: true })).toBeFocused();
    await updated.getByRole("button", { name: "Editar datos", exact: true }).click();
    await expect(form.getByLabel("DNI/NIE")).toHaveValue("87654321X");
    await form.getByRole("button", { name: "Cancelar edición de datos" }).click();
    await expect(updated.getByRole("button", { name: "Editar datos", exact: true })).toBeFocused();
    expect(bodies).toHaveLength(1);
  });
}

test("@mobile validacion local y conflicto PATCH conservan formulario y revision", async ({ page }) => {
  await mount(page);
  await scan(page);
  await page.locator("#omr-student").selectOption(studentId);
  const review = page.getByRole("region", { name: "Revisión de respuestas, tabla desplazable" });
  const before = await review.innerHTML();
  let patches = 0;
  await page.route(`**/api/exams/${examId}/students/${studentId}`, async (route) => {
    patches++;
    await route.fulfill({ status: 409, json: { error: "Datos modificados en otro dispositivo. Recarga la ficha." } });
  });
  await page.getByRole("row").filter({ hasText: "Alumno corregido" }).getByRole("button", { name: "Editar datos", exact: true }).click();
  const form = page.getByRole("form", { name: /Editar datos de/ });
  await form.getByLabel("DNI/NIE").fill("12345678A");
  await form.getByRole("button", { name: "Guardar datos", exact: true }).click();
  await expect(form.getByRole("alert")).toBeVisible();
  expect(patches).toBe(0);
  await form.getByLabel("DNI/NIE").fill("87654321X");
  await form.getByRole("button", { name: "Guardar datos", exact: true }).click();
  await expect(form.getByRole("alert")).toHaveText("Datos modificados en otro dispositivo. Recarga la ficha.");
  await expect(form.getByLabel("DNI/NIE")).toHaveAttribute("aria-describedby", "edit-student-error");
  expect(patches).toBe(1);
  expect(await review.innerHTML()).toBe(before);
  await page.route(`**/api/exams/${examId}/students`, (route) => route.fulfill({ json: { students: [{
    id: studentId, name: "Alumno remoto", dni: "X1234567L", savedAt: "2026-01-01T12:00:00Z",
    answers: [{ questionNo: 1, optionIndex: 3 }], correct: 0, wrong: 3, blank: 1,
    rawScore: "0", score: "0", version: 8,
  }] } }));
  await form.getByRole("button", { name: "Recargar ficha sin descartar la revisión" }).click();
  await expect(form.getByLabel("Nombre completo")).toHaveValue("Alumno remoto");
  await expect(form.getByLabel("DNI/NIE")).toHaveValue("X1234567L");
  await expect(form.getByRole("alert")).toHaveCount(0);
  expect(await review.innerHTML()).toBe(before);
  const remoteRow = page.getByRole("row").filter({ hasText: "Alumno remoto" });
  await expect(remoteRow.locator("td").nth(3)).toHaveText("1");
  await expect(remoteRow.locator("td").nth(7)).toHaveText("2.5");
  await form.getByRole("button", { name: "Cancelar edición de datos" }).click();
  let submitted: unknown;
  await page.route(`**/api/exams/${examId}/results`, async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ json: { result: { version: 8, correct: 1, wrong: 2, blank: 1, score: "2.5" } } });
  });
  await page.getByRole("button", { name: "Confirmar todas las respuestas" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Confirmar entrega y nota" }).click();
  await expect.poll(() => submitted).toEqual({
    studentId, replace: true, expectedVersion: 7,
    answers: [0, null, 1, 2].map((optionIndex, index) => ({ questionNo: index + 1, optionIndex })),
  });
});

test("@mobile cambiar de ficha lleva el foco al nombre y cancelar vuelve al ultimo boton", async ({ page }) => {
  await mount(page);
  const saved = page.getByRole("row").filter({ hasText: "Alumno corregido" }).getByRole("button", { name: "Editar datos", exact: true });
  const pending = page.getByRole("row").filter({ hasText: "Alumno pendiente" }).getByRole("button", { name: "Editar datos", exact: true });
  const name = page.getByRole("form", { name: /Editar datos de/ }).getByLabel("Nombre completo");
  await saved.click();
  await expect(name).toBeFocused();
  await pending.click();
  await expect(name).toHaveValue("Alumno pendiente");
  await expect(name).toBeFocused();
  await page.getByRole("button", { name: "Cancelar edición de datos" }).click();
  await expect(pending).toBeFocused();
});

for (const operation of ["create", "delete-result", "save-result"] as const) {
  for (const first of ["patch", "operation"] as const) {
    test(`@mobile ${operation} y PATCH fuera de orden: termina primero ${first}`, async ({ page }) => {
      await mount(page);
      if (operation === "save-result") {
        await scan(page);
        await page.locator("#omr-student").selectOption(studentId);
        await page.getByRole("button", { name: "Confirmar todas las respuestas" }).click();
      }
      let releaseOperation!: () => void;
      let releasePatch!: () => void;
      const operationGate = new Promise<void>((resolve) => { releaseOperation = resolve; });
      const patchGate = new Promise<void>((resolve) => { releasePatch = resolve; });
      let operationStarted = false;
      let patchStarted = false;
      await page.route(`**/api/exams/${examId}/${operation === "create" ? "students" : operation === "save-result" ? "results" : `results/${studentId}`}`, async (route) => {
        operationStarted = true;
        await operationGate;
        await route.fulfill({ json: operation === "create"
          ? { student: { id: "00000000-0000-4000-8000-000000000006", name: "Alumno nuevo", dni: "00000001R" } }
          : operation === "save-result" ? { result: { version: 8, correct: 2, wrong: 1, blank: 1, rawScore: "2", score: "5" } } : {} });
      });
      await page.route(`**/api/exams/${examId}/students/${studentId}`, async (route) => {
        patchStarted = true;
        await patchGate;
        await route.fulfill({ json: { student: { id: studentId, name: "Alumno actualizado", dni: "87654321X" } } });
      });
      const row = page.getByRole("row").filter({ hasText: "Alumno corregido" });
      if (operation === "create") {
        await page.locator("#student-name").fill("Alumno nuevo");
        await page.locator("#student-dni").fill("00000001R");
        await page.getByRole("button", { name: "Añadir alumno" }).click();
      } else {
        page.once("dialog", (dialog) => dialog.accept());
        if (operation === "save-result") await page.getByRole("button", { name: "Confirmar entrega y nota" }).click();
        else await row.getByRole("button", { name: "Eliminar entrega", exact: true }).click();
      }
      await expect.poll(() => operationStarted).toBe(true);
      await row.getByRole("button", { name: "Editar datos", exact: true }).click();
      const form = page.getByRole("form", { name: /Editar datos de/ });
      await form.getByLabel("Nombre completo").fill("Alumno actualizado");
      await form.getByLabel("DNI/NIE").fill("87654321X");
      await form.getByRole("button", { name: "Guardar datos", exact: true }).click();
      await expect.poll(() => patchStarted).toBe(true);
      const operationComplete = async () => {
        if (operation === "create") await expect(page.getByRole("row").filter({ hasText: "Alumno nuevo" })).toBeVisible();
        else if (operation === "save-result") await expect(page.getByRole("row").filter({ hasText: /Alumno (corregido|actualizado)/ }).locator("td").nth(7)).toHaveText("5");
        else await expect(page.getByRole("row").filter({ hasText: /Alumno (corregido|actualizado)/ }).locator("td").nth(2)).toHaveText("Pendiente");
      };
      if (first === "patch") {
        releasePatch();
        await expect(form).toHaveCount(0);
        releaseOperation();
        await operationComplete();
      } else {
        releaseOperation();
        await operationComplete();
        releasePatch();
        await expect(form).toHaveCount(0);
      }
      const updated = page.getByRole("row").filter({ hasText: "Alumno actualizado" });
      await expect(updated).toBeVisible();
      await expect(updated.locator("td").nth(1)).toHaveText("87654321X");
      if (operation === "create") await expect(page.getByRole("row").filter({ hasText: "Alumno nuevo" })).toBeVisible();
      else if (operation === "save-result") await expect(updated.locator("td").nth(7)).toHaveText("5");
      else await expect(updated.locator("td").nth(2)).toHaveText("Pendiente");
    });
  }
}
