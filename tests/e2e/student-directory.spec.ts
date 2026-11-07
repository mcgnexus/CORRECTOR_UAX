import { expect, test, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import path from "node:path";
import { readFileSync } from "node:fs";
import type { build as Esbuild } from "esbuild";

const localRequire = createRequire(path.resolve("package.json"));
const { build } = createRequire(localRequire.resolve("tsx"))("esbuild") as { build: typeof Esbuild };
const studentId = "00000000-0000-4000-8000-000000000003";
const otherId = "00000000-0000-4000-8000-000000000004";
const newId = "00000000-0000-4000-8000-000000000005";
const examId = "00000000-0000-4000-8000-000000000002";
const initialStudents = [
  { id: studentId, version: 1, name: "Ana Directorio", dni: null, email: "ana@example.test", academicCode: "UAX-001", groups: ["LAB 1"], metadata: { Notas: "Turno de tarde", Tutor: "Tutor original" } },
  { id: otherId, version: 1, name: "Bruno Directorio", dni: "00000001R", email: null, academicCode: null, groups: ["LAB 2"], metadata: {} },
];
let script: string;
const styles = readFileSync(path.resolve("src/app/globals.css"), "utf8");

test.beforeAll(async () => {
  const output = await build({
    stdin: {
      contents: `import React from 'react';
        import {createRoot} from 'react-dom/client';
        import StudentsClient from './src/app/alumnos/client';
        createRoot(document.getElementById('root')).render(<StudentsClient
          initialStudents={${JSON.stringify(initialStudents)}} exams={[{id:'${examId}',title:'Genetica final'}]}/>);`,
      resolveDir: process.cwd(), loader: "tsx",
    },
    bundle: true, write: false, platform: "browser", format: "esm", jsx: "automatic",
    alias: { "@": path.resolve("src") },
    plugins: [{ name: "next-browser-fixture", setup(builder) {
      builder.onResolve({ filter: /^(next\/link|next\/navigation)$/ }, (args) => ({ path: args.path, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
        contents: args.path === "next/navigation"
          ? "export function useRouter(){return {push:()=>{},refresh:()=>{}}}"
          : "import React from 'react'; export default function Link(props){return React.createElement('a',props)}",
        resolveDir: process.cwd(),
      }));
    } }],
  });
  script = output.outputFiles[0].text;
});

async function mount(page: Page) {
  await page.route("https://student-directory.test/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/fixture.js") return route.fulfill({ contentType: "text/javascript", body: script });
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: `<html lang="es"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Student directory fixture</title><style>${styles}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>` });
    if (url.pathname === "/api/students" && route.request().method() === "GET") return route.fulfill({ json: { students: initialStudents } });
    throw new Error(`Peticion inesperada: ${route.request().method()} ${url.pathname}`);
  });
  await page.goto("https://student-directory.test/");
  await expect(page.getByRole("heading", { name: "Alumnos", exact: true })).toBeVisible();
}

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

function studentCard(page: Page, name: string) {
  return page.getByRole("listitem").filter({ has: page.getByRole("checkbox", { name: `Seleccionar ${name}`, exact: true }) });
}

test("@mobile busca por correo y filtra por grupo sin perder fichas", async ({ page }) => {
  await mount(page);
  const search = page.getByRole("searchbox", { name: "Buscar alumnos" });
  await search.fill("ana@example.test");
  await expect(studentCard(page, "Ana Directorio")).toBeVisible();
  await expect(studentCard(page, "Bruno Directorio")).toHaveCount(0);
  await search.fill("");
  await page.getByLabel("Filtrar por grupo").selectOption({ label: "LAB 2" });
  await expect(studentCard(page, "Bruno Directorio")).toBeVisible();
  await expect(studentCard(page, "Ana Directorio")).toHaveCount(0);
  await expectNoOverflow(page);
});

test("@mobile crea alumno sin DNI y bloquea doble envio mientras guarda", async ({ page }) => {
  await mount(page);
  const bodies: unknown[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/students", async (route) => {
    expect(route.request().method()).toBe("POST");
    const body = route.request().postDataJSON();
    bodies.push(body);
    await gate;
    await route.fulfill({ status: 201, json: { student: { id: newId, ...body } } });
  });
  await page.getByRole("button", { name: "Nuevo alumno", exact: true }).click();
  await page.getByLabel("Nombre completo", { exact: true }).fill("Carla Sin Documento");
  await expect(page.getByLabel("DNI/NIE (opcional, recomendado)", { exact: true })).toHaveValue("");
  await page.getByLabel("Correo del alumno", { exact: true }).fill("carla@example.test");
  await page.getByLabel(/c[oó]digo acad[eé]mico/i).fill("UAX-003");
  await page.getByLabel("Grupos (separados por comas)", { exact: true }).fill("LAB 3");
  await expectNoOverflow(page);
  const save = page.getByRole("button", { name: "Guardar alumno", exact: true });
  // Two native clicks in one browser task exercise the handler's in-flight guard.
  await save.evaluate((node: HTMLButtonElement) => { node.click(); node.click(); });
  await expect.poll(() => bodies.length).toBe(1);
  await expect(save).toBeDisabled();
  expect(bodies).toEqual([{ name: "Carla Sin Documento", dni: null, email: "carla@example.test", academicCode: "UAX-003", groups: ["LAB 3"], metadata: {} }]);
  release();
  await expect(studentCard(page, "Carla Sin Documento")).toBeVisible();
  expect(bodies).toHaveLength(1);
  await expectNoOverflow(page);
});

test("@mobile editar nombre conserva correo grupos codigo y metadata originales", async ({ page }) => {
  await mount(page);
  let payload: unknown;
  await page.route(`**/api/students/${studentId}`, async (route) => {
    expect(route.request().method()).toBe("PATCH");
    payload = route.request().postDataJSON();
    await route.fulfill({ json: { student: { id: studentId, ...(payload as object), version: 2 } } });
  });
  await page.getByRole("button", { name: "Editar ficha", exact: true }).first().click();
  await expect(page.getByLabel("Nombre completo", { exact: true })).toHaveValue("Ana Directorio");
  await page.getByLabel("Nombre completo", { exact: true }).fill("Ana Actualizada");
  await page.getByRole("button", { name: "Guardar alumno", exact: true }).click();
  await expect(studentCard(page, "Ana Actualizada")).toBeVisible();
  expect(payload).toEqual({ name: "Ana Actualizada", dni: null, email: "ana@example.test", academicCode: "UAX-001", groups: ["LAB 1"], metadata: initialStudents[0].metadata, expectedVersion: 1 });
  await page.getByRole("button", { name: "Editar ficha", exact: true }).first().click();
  await expect(page.getByLabel("Correo del alumno", { exact: true })).toHaveValue("ana@example.test");
  await expect(page.getByLabel("Grupos (separados por comas)", { exact: true })).toHaveValue("LAB 1");
  await expect(page.getByLabel("Notas", { exact: true })).toHaveValue("Turno de tarde");
  await expect(page.getByLabel("Tutor", { exact: true })).toHaveValue("Tutor original");
  await expectNoOverflow(page);
});

test("@mobile eliminar exige confirmacion y cancelar no escribe", async ({ page }) => {
  await mount(page);
  let deletes = 0;
  await page.route(`**/api/students/${studentId}`, async (route) => {
    expect(route.request().method()).toBe("DELETE");
    deletes++;
    await route.fulfill({ json: { status: "deleted" } });
  });
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Eliminar ficha", exact: true }).first().click();
  expect(deletes).toBe(0);
  await expect(studentCard(page, "Ana Directorio")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Eliminar ficha", exact: true }).first().click();
  await expect(studentCard(page, "Ana Directorio")).toHaveCount(0);
  expect(deletes).toBe(1);
  await expect(studentCard(page, "Bruno Directorio")).toBeVisible();
});

test("@mobile conflicto de ficha conserva borrador y permite recargar version actual", async ({ page }) => {
  await mount(page);
  await page.route(`**/api/students/${studentId}`, async (route) => {
    expect(route.request().postDataJSON().expectedVersion).toBe(1);
    await route.fulfill({ status: 409, json: { error: "La ficha cambió en otra pestaña. Recarga las fichas.", code: "version_conflict" } });
  });
  await page.getByRole("button", { name: "Editar ficha", exact: true }).first().click();
  await page.getByLabel("Nombre completo", { exact: true }).fill("Nombre en borrador");
  await page.getByRole("button", { name: "Guardar alumno", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("otra pestaña");
  await expect(page.getByLabel("Nombre completo", { exact: true })).toHaveValue("Nombre en borrador");
  await expect(studentCard(page, "Ana Directorio")).toBeVisible();
  await page.route("**/api/students", async (route) => {
    expect(route.request().method()).toBe("GET");
    await route.fulfill({ json: { students: [{ ...initialStudents[0], version: 2, name: "Nombre vigente" }, initialStudents[1]] } });
  });
  await page.getByRole("button", { name: "Recargar fichas", exact: true }).click();
  await expect(studentCard(page, "Nombre vigente")).toBeVisible();
  await page.getByRole("button", { name: "Editar ficha", exact: true }).first().click();
  await expect(page.getByLabel("Nombre completo", { exact: true })).toHaveValue("Nombre vigente");
});

test("@mobile asigna solo seleccionados y evita duplicar peticiones", async ({ page }) => {
  await mount(page);
  const bodies: unknown[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/students/assign", async (route) => {
    expect(route.request().method()).toBe("POST");
    bodies.push(route.request().postDataJSON());
    await gate;
    await route.fulfill({ json: { status: "assigned", count: 1 } });
  });
  await page.getByLabel("Seleccionar Ana Directorio", { exact: true }).check();
  await page.getByLabel("Examen de destino", { exact: true }).selectOption(examId);
  const assign = page.getByRole("button", { name: "Asignar seleccionados", exact: true });
  await assign.evaluate((node: HTMLButtonElement) => { node.click(); node.click(); });
  await expect.poll(() => bodies.length).toBe(1);
  await expect(assign).toBeDisabled();
  expect(bodies).toEqual([{ examId, studentIds: [studentId] }]);
  release();
  await expect(assign).toBeEnabled();
  await expect(page.getByRole("status")).toContainText("Se han añadido 1 inscripciones");
  expect(bodies).toHaveLength(1);
});

test("@mobile previsualizar Excel no escribe y confirmar preserva correo grupo notas y origen", async ({ page }) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch;
    window.fetch = async (input, init) => {
      if (input === "/api/students/import" && init?.method === "POST") {
        // WebKit's routing protocol omits File request bodies. Observe the same
        // unmodified bytes at fetch's boundary without replacing browser upload.
        if (!(init.body instanceof File)) throw new Error("La vista previa debe enviar el archivo binario.");
        (window as unknown as { directoryPreviewBytes: number[] }).directoryPreviewBytes = Array.from(new Uint8Array(await init.body.arrayBuffer()));
      }
      return originalFetch(input, init);
    };
  });
  await mount(page);
  const excel = Buffer.from("PK\u0003\u0004synthetic-workbook-api-boundary", "utf8");
  const imported = { name: "Clara Importada", dni: null, email: "clara@example.test", academicCode: "UAX-004", groups: ["LAB 3"], metadata: { Notas: "Necesita material adicional" }, sourceSheet: "Practicas", sourceRow: 2 };
  const mutations: Array<{ method: string; body: unknown }> = [];
  let previews = 0;
  let committed = false;
  await page.route("**/api/students", (route) => {
    expect(route.request().method()).toBe("GET");
    expect(committed).toBe(true);
    return route.fulfill({ json: { students: [...initialStudents, { id: newId, ...imported, metadata: { ...imported.metadata, Origen: "Practicas, fila 2" } }] } });
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/students/import", async (route) => {
    const method = route.request().method();
    if (method === "POST") {
      previews++;
      const bytes = await page.evaluate(() => (window as unknown as { directoryPreviewBytes: number[] }).directoryPreviewBytes);
      expect(Buffer.from(bytes)).toEqual(excel);
      const exposedBody = route.request().postDataBuffer();
      if (exposedBody !== null) expect(exposedBody).toEqual(excel);
      if (previews > 1) expect(JSON.parse(route.request().headers()["x-sheet-selection"])).toEqual([{ sheet: "Practicas", mapping: { name: 0, email: 1, groups: 2 } }]);
      return route.fulfill({ json: {
        sheets: [{ name: "Practicas", hidden: false, headers: ["Nombre", "Correo", "Grupo", "Notas"], rowCount: 1, mapping: { name: 0, email: 1, groups: 2 } }],
        students: [imported], problems: [],
      } });
    }
    expect(method).toBe("PATCH");
    mutations.push({ method, body: route.request().postDataJSON() });
    await gate;
    committed = true;
    await route.fulfill({ json: { status: "imported", count: 1 } });
  });
  await page.getByLabel("Archivo Excel", { exact: true }).setInputFiles({ name: "synthetic.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: excel });
  await page.getByRole("button", { name: "Previsualizar Excel", exact: true }).click();
  const preview = page.getByRole("row").filter({ has: page.getByRole("checkbox", { name: "Importar fila 2 de Practicas", exact: true }) });
  await expect(preview).toContainText("Clara Importada");
  await expect(preview).toContainText("clara@example.test");
  await expect(preview).toContainText("LAB 3");
  await expect(preview).toContainText("Notas: Necesita material adicional");
  expect(previews).toBe(1);
  expect(mutations).toEqual([]);
  await expect(studentCard(page, "Clara Importada")).toHaveCount(0);
  const confirm = page.getByRole("button", { name: "Confirmar importación", exact: true });
  await expect(confirm).toBeDisabled();
  await page.getByRole("checkbox", { name: /He revisado/i }).check();
  const mapping = page.getByRole("group", { name: "Practicas (1 filas)", exact: true });
  await mapping.getByRole("combobox", { name: "Correo", exact: true }).selectOption("-1");
  await expect(confirm).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: /He revisado/i })).not.toBeChecked();
  await mapping.getByRole("combobox", { name: "Correo", exact: true }).selectOption("1");
  await page.getByRole("button", { name: "Previsualizar Excel", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: /He revisado/i })).toBeEnabled();
  expect(previews).toBe(2);
  expect(mutations).toEqual([]);
  await page.getByRole("checkbox", { name: /He revisado/i }).check();
  await expectNoOverflow(page);
  await confirm.evaluate((node: HTMLButtonElement) => { node.click(); node.click(); });
  await expect.poll(() => mutations.length).toBe(1);
  await expect(confirm).toBeDisabled();
  const body = mutations[0].body as { students: Array<Record<string, unknown>>; acknowledgeUnidentified: boolean };
  expect(body.acknowledgeUnidentified).toBe(true);
  expect(body.students).toHaveLength(1);
  expect(body.students[0]).toMatchObject({ name: imported.name, dni: null, email: imported.email, academicCode: imported.academicCode, groups: imported.groups, metadata: { ...imported.metadata, Origen: expect.stringMatching(/Practicas.*2/) } });
  expect(body.students[0]).not.toHaveProperty("sourceSheet");
  expect(body.students[0]).not.toHaveProperty("sourceRow");
  release();
  await expect(studentCard(page, "Clara Importada")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Se han importado 1 alumnos");
  expect(mutations).toHaveLength(1);
  await expectNoOverflow(page);
});
