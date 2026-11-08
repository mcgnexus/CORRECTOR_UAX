import { expect, test, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import path from "node:path";
import type { build as Esbuild } from "esbuild";

const require = createRequire(path.resolve("package.json"));
const { build } = createRequire(require.resolve("tsx"))("esbuild") as { build: typeof Esbuild };
let script: string;
let realScript: string;
const updatedAt = "2026-11-08T10:00:00.000Z";

test.beforeAll(async () => {
  const contents = `import React,{useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import Calibrator from './src/app/examenes/[examId]/uax-grid-calibrator';
      import {syntheticUax} from './tests/fixtures/uax-grid/synthetic';
      window.makeSynthetic=()=>{const {image}=syntheticUax();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;
        const ctx=c.getContext('2d'),p=ctx.createImageData(c.width,c.height);for(let i=0;i<image.data.length;i++){p.data[i*4]=p.data[i*4+1]=p.data[i*4+2]=image.data[i];p.data[i*4+3]=255}ctx.putImageData(p,0,0);return c.toDataURL('image/png').split(',')[1]};
      function App(){const [exam,setExam]=useState('exam-test');window.changeExam=()=>setExam('other-exam');
        const [profile,setProfile]=useState({format:'uax-grid-40',version:1,
        tables:[],rowsPerBlock:20,blocks:2,optionsPerBlock:4,updatedAt:'${updatedAt}'});
        return <><Calibrator examId={exam} initialProfile={profile}
          onProfileChange={p=>{window.lastProfile=p;setProfile(p)}}/>
          <output data-testid="persisted">{profile?.updatedAt??'none'}</output></>}
      createRoot(document.getElementById('root')).render(<App/>);`;
  const output = await build({
    stdin: { contents, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "esm", jsx: "automatic",
    alias: { "@": path.resolve("src") },
    plugins: [{ name: "geometry-contract", setup(builder) {
      builder.onResolve({ filter: /matrix\/uax-grid$/ }, () => ({ path: "geometry", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `
        const corners=(w,h,left)=>[{x:w*left,y:h*.1},{x:w*(left+.3),y:h*.1},{x:w*(left+.3),y:h*.9},{x:w*left,y:h*.9}];
        export function detectUaxTables(i){return window.manualOnly?null:[{corners:corners(i.width,i.height,.1)},{corners:corners(i.width,i.height,.6)}]}
        export function projectUaxPoint(t,x,y){const [a,b,c,d]=t.corners;return {x:(1-y)*(a.x*(1-x)+b.x*x)+y*(d.x*(1-x)+c.x*x),y:(1-y)*(a.y*(1-x)+b.y*x)+y*(d.y*(1-x)+c.y*x)}}
        export function calibrateUaxGrid(i,tables){if(tables.length!==2)throw Error('Faltan tablas');return {format:'uax-grid-40',version:1,rowsPerBlock:20,blocks:2,optionsPerBlock:4,tables:tables.map(t=>({corners:t.corners.map(p=>({x:p.x/i.width,y:p.y/i.height})),reference:btoa(String.fromCharCode(255).repeat(320*880))}))}}
        export function locateUaxTablesByTaps(i,taps){if(window.manualOnly)return null;const half=i.width*.16;const quad=c=>({corners:[{x:c.x-half,y:c.y-half*2.75},{x:c.x+half,y:c.y-half*2.75},{x:c.x+half,y:c.y+half*2.75},{x:c.x-half,y:c.y+half*2.75}]});const a=quad(taps[0]),b=quad(taps[1]);return a.corners[0].x<b.corners[0].x?[a,b]:[b,a]}`, resolveDir: process.cwd() }));
    } }],
  });
  script = output.outputFiles[0].text;
  const real = await build({ stdin: { contents, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "esm", jsx: "automatic", alias: { "@": path.resolve("src") } });
  realScript = real.outputFiles[0].text;
});

async function mount(page: Page, real = false) {
  await page.route("https://uax-calibrator.test/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/fixture.js") return route.fulfill({ contentType: "text/javascript", body: real ? realScript : script });
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: '<html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/fixture.js"></script></html>' });
    throw new Error(`Petición inesperada: ${route.request().method()} ${url.pathname}`);
  });
  await page.goto("https://uax-calibrator.test/");
  await expect(page.getByRole("heading", { name: "Calibración UAX" })).toBeVisible();
}

async function upload(page: Page, width = 900, height = 1200) {
  const base64 = await page.evaluate(({ width, height }) => {
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d")!; ctx.fillStyle = "white"; ctx.fillRect(0, 0, width, height);
    return canvas.toDataURL("image/png").split(",")[1];
  }, { width, height });
  await page.getByLabel("Referencia en blanco (JPG o PNG)").setInputFiles({ name: "blank.png", mimeType: "image/png", buffer: Buffer.from(base64, "base64") });
  await expect(page.getByRole("button", { name: "Girar derecha" })).toBeEnabled();
}

test("confirma referencia, guarda solo tablas y usa updatedAt del servidor", async ({ page }) => {
  await mount(page); await upload(page, 2400, 1200);
  const canvas = page.getByLabel("Vista previa UAX", { exact: true });
  await expect(canvas).toHaveAttribute("width", "2000");
  await expect(page.getByRole("button", { name: "Guardar calibración" })).toBeDisabled();
  await page.getByRole("checkbox", { name: /Confirmo que ambas tablas/ }).check();
  const writes: object[] = []; let profile: object;
  await page.route("**/api/exams/exam-test/matrix", async route => {
    if (route.request().method() === "PUT") {
      profile = route.request().postDataJSON(); writes.push(profile);
      return route.fulfill({ json: { status: "saved" } });
    }
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: { profile: { ...profile, updatedAt: "2026-11-08T17:00:00.000Z" } } });
  });
  await page.getByRole("button", { name: "Guardar calibración" }).click();
  await expect(page.getByTestId("persisted")).toHaveText("2026-11-08T17:00:00.000Z");
  expect(writes).toHaveLength(1);
  expect(Object.keys(writes[0]).sort()).toEqual(["blocks", "format", "optionsPerBlock", "rowsPerBlock", "tables", "version"]);
  expect(JSON.stringify(writes[0])).not.toContain("data:image");
});

test("fallback de ocho puntos por teclado, ajuste, rotación y cancelar preservan perfil", async ({ page }) => {
  await mount(page); await page.evaluate("window.manualOnly=true"); await upload(page);
  await page.getByRole("button", { name: "Marcar ocho esquinas" }).click();
  for (let i = 0; i < 8; i++) await page.getByRole("button", { name: "Añadir esquina con teclado" }).click();
  await expect(page.getByLabel("Esquina seleccionada")).toHaveValue("7");
  await page.getByLabel("Coordenada X (píxeles)").fill("55");
  await expect(page.getByLabel("Coordenada X (píxeles)")).toHaveValue("55");
  await page.getByRole("button", { name: "Validar tablas y referencia" }).click();
  await expect(page.getByRole("checkbox", { name: /Confirmo que ambas tablas/ })).toBeVisible();
  await page.getByRole("button", { name: "Girar derecha" }).click();
  await expect(page.getByLabel("Vista previa UAX", { exact: true })).toHaveAttribute("width", "1200");
  await expect(page.getByLabel("Vista previa UAX", { exact: true })).toHaveAttribute("height", "900");
  await page.getByRole("button", { name: "Cancelar cambios" }).click();
  await expect(page.getByTestId("persisted")).toHaveText(updatedAt);
  await expect(page.getByRole("button", { name: "Guardar calibración" })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("un error de guardado conserva perfil y permite reintento", async ({ page }) => {
  await mount(page); await upload(page);
  await page.getByRole("checkbox", { name: /Confirmo que ambas tablas/ }).check();
  await page.route("**/api/exams/exam-test/matrix", route => route.fulfill({ status: 422, json: { error: "El formato ha cambiado." } }));
  await page.getByRole("button", { name: "Guardar calibración" }).click();
  await expect(page.getByRole("alert")).toContainText("El formato ha cambiado.");
  await expect(page.getByTestId("persisted")).toHaveText(updatedAt);
  await expect(page.getByRole("button", { name: "Guardar calibración" })).toBeEnabled();
});

test("desactiva perfil anterior si PUT se confirma pero GET falla", async ({ page }) => {
  await mount(page); await upload(page);
  await page.getByRole("checkbox", { name: /Confirmo que ambas tablas/ }).check();
  await page.route("**/api/exams/exam-test/matrix", route => route.request().method() === "PUT"
    ? route.fulfill({ json: { status: "saved" } })
    : route.fulfill({ status: 503, json: { error: "No disponible" } }));
  await page.getByRole("button", { name: "Guardar calibración" }).click();
  await expect(page.getByTestId("persisted")).toHaveText("none");
  await expect(page.getByRole("alert")).toContainText("lectura deshabilitada");
});

test("rechaza otros formatos y más de 20 MB; eliminar exige confirmación", async ({ page }) => {
  await mount(page);
  const input = page.getByLabel("Referencia en blanco (JPG o PNG)");
  await input.setInputFiles({ name: "photo.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a") });
  await expect(page.getByRole("alert")).toContainText("JPG o PNG");
  await input.setInputFiles({ name: "large.png", mimeType: "image/png", buffer: Buffer.alloc(20 * 1024 * 1024 + 1) });
  await expect(page.getByRole("alert")).toContainText("20 MB");
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "Eliminar calibración" }).click();
  await expect(page.getByTestId("persisted")).toHaveText(updatedAt);
  await page.route("**/api/exams/exam-test/matrix", route => {
    expect(route.request().method()).toBe("DELETE");
    return route.fulfill({ status: 204 });
  });
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Eliminar calibración" }).click();
  await expect(page.getByTestId("persisted")).toHaveText("none");
});

test("cambiar de examen durante un guardado no bloquea el nuevo ni aplica respuestas antiguas", async ({ page }) => {
  await mount(page); await upload(page);
  await page.getByRole("checkbox", { name: /Confirmo que ambas tablas/ }).check();
  let writes = 0; let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/exams/exam-test/matrix", async route => {
    writes++; await gate; await route.fulfill({ json: { status: "saved" } });
  });
  await page.getByRole("button", { name: "Guardar calibración" }).click();
  await expect.poll(() => writes).toBe(1);
  await page.evaluate("window.changeExam()");
  await expect(page.getByLabel("Referencia en blanco (JPG o PNG)")).toBeEnabled();
  release();
  await expect(page.getByTestId("persisted")).toHaveText(updatedAt);
});

test("integra detección y calibración reales con dos tablas sintéticas", async ({ page }) => {
  await mount(page, true);
  const base64 = await page.evaluate<string>("window.makeSynthetic()");
  await page.getByLabel("Referencia en blanco (JPG o PNG)").setInputFiles({ name: "synthetic.png", mimeType: "image/png", buffer: Buffer.from(base64, "base64") });
  await expect(page.getByRole("checkbox", { name: /Confirmo que ambas tablas/ })).toBeVisible();
  await expect(page.getByLabel("Esquina seleccionada")).toHaveValue("0");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByLabel("Coordenada X (píxeles)").fill("0");
  await expect(page.getByRole("button", { name: "Guardar calibración" })).toBeDisabled();
  await page.getByRole("button", { name: "Validar tablas y referencia" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
});
