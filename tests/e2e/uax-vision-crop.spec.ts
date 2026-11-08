import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import path from "node:path";
import type { build as Esbuild } from "esbuild";

const require = createRequire(path.resolve("package.json"));
const { build } = createRequire(require.resolve("tsx"))("esbuild") as { build: typeof Esbuild };

test("exige dos recortes y consentimiento renovado y entrega las vistas previas en orden", async ({ page }) => {
  const result = await build({ stdin: { contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import Crop from './src/app/examenes/[examId]/uax-vision-crop';
    const canvas=document.createElement('canvas'); canvas.width=400; canvas.height=400;
    const ctx=canvas.getContext('2d'); ctx.fillStyle='red'; ctx.fillRect(0,0,200,400); ctx.fillStyle='blue'; ctx.fillRect(200,0,200,400);
    createRoot(document.getElementById('root')).render(<Crop canvas={canvas} busy={false} onSubmit={v=>window.result=v} onCancel={()=>{}}/>);
  `, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "esm", jsx: "automatic" });
  await page.route("https://crop.test/**", route => route.fulfill(route.request().url().endsWith(".js") ? { contentType: "text/javascript", body: result.outputFiles[0].text } : { contentType: "text/html", body: '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/fixture.js"></script>' }));
  await page.goto("https://crop.test/");
  const send = page.getByRole("button", { name: "Enviar recortes" });
  await expect(send).toBeDisabled();
  for (const [label, values] of [["izquierda", [10, 40, 100, 200]], ["derecha", [220, 40, 100, 200]]] as const) {
    const group = page.getByRole("group", { name: new RegExp(label) });
    for (const [name, value] of ["X", "Y", "Ancho", "Alto"].map((name, i) => [name, values[i]] as const)) await group.getByLabel(name, { exact: true }).fill(String(value));
    await group.getByRole("button", { name: "Aplicar coordenadas" }).click();
  }
  await page.getByRole("button", { name: "Preparar vista previa" }).click();
  const previews = page.locator('img[alt^="Recorte"]');
  await expect(previews).toHaveCount(2);
  await expect(send).toBeDisabled();
  await page.getByRole("checkbox").check();
  const expected = await previews.evaluateAll(nodes => nodes.map(node => (node as HTMLImageElement).src));
  await send.click();
  expect(await page.evaluate(() => (window as unknown as { result: string[] }).result)).toEqual(expected);
  await expect(send).toBeDisabled();
  await page.getByRole("checkbox").check();
  const surface = page.getByLabel("Imagen original para seleccionar las tablas");
  await surface.scrollIntoViewIfNeeded();
  const box = (await surface.boundingBox())!;
  await page.mouse.move(box.x + box.width * .05, box.y + box.height * .15);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .4, box.y + box.height * .7);
  await page.mouse.up();
  await expect(previews).toHaveCount(0);
  await expect(send).toBeDisabled();
  await page.getByRole("button", { name: "Preparar vista previa" }).click();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await expect(send).toBeDisabled();
});
