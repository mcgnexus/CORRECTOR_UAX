import { hash } from "@node-rs/argon2";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { closeDb, getDb } from "../../src/db";
import { users } from "../../src/db/schema";
import { validateTestDatabaseUrl } from "../../src/lib/database-url-safety";

const initialPassword = "AccountFixture!2026";
const newPassword = "AccountFixture!2027";

function assertDisposableDatabase() {
  const testUrl = validateTestDatabaseUrl({
    DATABASE_URL_TEST: process.env.DATABASE_URL_TEST,
    DATABASE_URL: process.env.DATABASE_URL_NORMAL,
  });
  if (process.env.DATABASE_URL !== testUrl) {
    throw new Error("El E2E de cuenta requiere la configuracion raiz apuntando a DATABASE_URL_TEST.");
  }
}

// Same Argon2 fixture and browser sign-in pattern as hardening.spec.ts; no shared test imports.
async function createTestUser(name: string, email: string) {
  assertDisposableDatabase();
  const passwordHash = await hash(initialPassword, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  const [user] = await getDb().insert(users).values({ name, email, passwordHash }).returning({ id: users.id });
  return { id: user.id, name, email };
}

async function removeTestUsers(ids: string[]) {
  if (ids.length === 0) return;
  assertDisposableDatabase();
  await Promise.all(ids.map((id) => getDb().delete(users).where(eq(users.id, id))));
}

async function submitLogin(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico", { exact: true }).fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
}

async function signIn(page: Page, email: string, password = initialPassword) {
  await submitLogin(page, email, password);
  await page.waitForURL(/\/examenes$/, { timeout: 45_000 });
}

async function expectRejectedLogin(page: Page, email: string, password: string) {
  await submitLogin(page, email, password);
  await expect(page.locator("main").getByRole("alert")).toContainText("Correo o contraseña incorrectos.");
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get("/api/account")).status()).toBe(401);
}

async function submitAccount(page: Page, buttonName: string) {
  const response = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/account" && response.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: buttonName, exact: true }).click();
  return response;
}

test("Mi cuenta: perfil privado y ambas credenciales revocan dos sesiones reales @mobile", async ({ page, browser, baseURL, request }) => {
  // Multiple real sign-ins and revocations use a remote disposable PostgreSQL DB.
  test.setTimeout(300_000);
  assertDisposableDatabase();
  const createdIds: string[] = [];
  const contexts: BrowserContext[] = [];
  const nonce = randomUUID();
  const originalEmail = `account-${nonce}@test.invalid`;
  const changedEmail = `account-new-${nonce}@test.invalid`;
  try {
    const owner = await createTestUser("Docente Ficticio", originalEmail);
    createdIds.push(owner.id);
    const outsider = await createTestUser("Otra Cuenta Ficticia", `account-other-${nonce}@test.invalid`);
    createdIds.push(outsider.id);
    const secondContext = await browser.newContext({ baseURL });
    const otherContext = await browser.newContext({ baseURL });
    contexts.push(secondContext, otherContext);
    const secondPage = await secondContext.newPage();
    const otherPage = await otherContext.newPage();

    expect((await request.get("/api/account")).status()).toBe(401);
    expect((await request.patch("/api/account", { data: { name: "No autorizado" } })).status()).toBe(401);
    await signIn(page, originalEmail);
    await signIn(secondPage, originalEmail);
    await signIn(otherPage, outsider.email);
    await page.goto("/cuenta");
    await expect(page.getByRole("heading", { name: "Mi cuenta", exact: true })).toBeVisible();
    await expect(page.getByLabel("Correo electronico", { exact: true })).toHaveValue(originalEmail);
    await expect(page.getByLabel("Apellidos (opcional)", { exact: true })).toHaveValue("");

    const initialProfile = await (await page.request.get("/api/account")).json();
    expect(initialProfile).toMatchObject({ id: owner.id, name: owner.name, email: originalEmail });
    expect(Object.keys(initialProfile).sort()).toEqual(["department", "email", "id", "institution", "lastName", "name"].sort());
    const otherBefore = await (await otherPage.request.get("/api/account")).json();
    const privateRead = await otherPage.request.get(`/api/account?userId=${owner.id}`);
    expect((await privateRead.json()).id).toBe(outsider.id);
    for (const forbidden of [{ id: owner.id, name: "Intento ajeno" }, { role: "admin" }, { sessionVersion: 999 }]) {
      expect((await otherPage.request.patch("/api/account", { data: forbidden })).status()).toBe(400);
    }

    // A legacy full name plus matching lastName must not duplicate the surname in the session.
    await page.getByLabel("Nombre o nombre completo", { exact: true }).fill("Docente Ficticio Prueba");
    await page.getByLabel("Apellidos (opcional)", { exact: true }).fill("Prueba");
    await page.getByLabel("Centro o universidad (opcional)", { exact: true }).fill("Centro Ficticio");
    await page.getByLabel("Departamento (opcional)", { exact: true }).fill("Departamento Ficticio");
    expect((await submitAccount(page, "Guardar perfil")).status()).toBe(200);
    await expect(page.getByRole("status").filter({ hasText: "Perfil actualizado." })).toBeVisible();
    const secondProfile = await secondPage.request.get("/api/account");
    expect(secondProfile.status()).toBe(200);
    expect(await secondProfile.json()).toMatchObject({ id: owner.id, name: "Docente Ficticio Prueba", lastName: "Prueba", institution: "Centro Ficticio", department: "Departamento Ficticio" });
    const refreshedSession = await (await secondPage.request.get("/api/auth/session")).json();
    expect(refreshedSession.user.name).toBe("Docente Ficticio Prueba");
    await page.reload();
    await expect(page.getByLabel("Departamento (opcional)", { exact: true })).toHaveValue("Departamento Ficticio");

    expect((await page.request.patch("/api/account", { data: { email: changedEmail } })).status()).toBe(400);
    await page.getByLabel("Correo electronico", { exact: true }).fill(changedEmail.toUpperCase());
    const emailPassword = page.getByLabel("Contrasena actual para cambiar el correo", { exact: true });
    await expect(emailPassword).toHaveAttribute("required", "");
    await emailPassword.fill("incorrect-password");
    expect((await submitAccount(page, "Guardar perfil")).status()).toBe(403);
    await expect(page.locator("main").getByRole("alert")).toContainText("No se pudo verificar la contrasena actual.");
    expect((await (await secondPage.request.get("/api/account")).json()).email).toBe(originalEmail);
    await emailPassword.fill(initialPassword);
    const emailChange = await submitAccount(page, "Guardar perfil");
    expect(emailChange.status()).toBe(200);
    expect(await emailChange.json()).toMatchObject({ reauthenticate: true, profile: { id: owner.id, email: changedEmail } });
    await expect(page.getByRole("status").filter({ hasText: "Credenciales actualizadas." })).toBeVisible();
    expect((await page.request.get("/api/account")).status()).toBe(401);
    expect((await secondPage.request.get("/api/account")).status()).toBe(401);
    await expectRejectedLogin(secondPage, originalEmail, initialPassword);
    await signIn(secondPage, changedEmail);
    await page.getByRole("button", { name: "Iniciar sesion de nuevo", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await signIn(page, changedEmail);
    await page.goto("/cuenta");

    const passwordChange = { newPassword, confirmPassword: newPassword };
    expect((await page.request.patch("/api/account", { data: passwordChange })).status()).toBe(400);
    await page.getByLabel("Contrasena actual", { exact: true }).fill("incorrect-password");
    await page.getByLabel("Nueva contrasena (12-128 caracteres)", { exact: true }).fill(newPassword);
    await page.getByLabel("Repetir nueva contrasena", { exact: true }).fill(newPassword);
    expect((await submitAccount(page, "Cambiar contrasena y cerrar sesiones")).status()).toBe(403);
    await expect(page.locator("main").getByRole("alert")).toContainText("No se pudo verificar la contrasena actual.");
    expect((await secondPage.request.get("/api/account")).status()).toBe(200);
    await page.getByLabel("Contrasena actual", { exact: true }).fill(initialPassword);
    const passwordResponse = await submitAccount(page, "Cambiar contrasena y cerrar sesiones");
    expect(passwordResponse.status()).toBe(200);
    expect(await passwordResponse.json()).toMatchObject({ reauthenticate: true });
    await expect(page.getByRole("status").filter({ hasText: "Credenciales actualizadas." })).toBeVisible();
    expect((await page.request.get("/api/account")).status()).toBe(401);
    expect((await secondPage.request.get("/api/account")).status()).toBe(401);
    await expectRejectedLogin(secondPage, changedEmail, initialPassword);
    await signIn(secondPage, changedEmail, newPassword);
    expect((await (await secondPage.request.get("/api/account")).json()).id).toBe(owner.id);
    await secondPage.goto("/cuenta");
    await expect(secondPage.getByLabel("Correo electronico", { exact: true })).toHaveValue(changedEmail);
    await expect(secondPage.getByLabel("Centro o universidad (opcional)", { exact: true })).toHaveValue("Centro Ficticio");

    const otherAfter = await otherPage.request.get("/api/account");
    expect(otherAfter.status()).toBe(200);
    expect(await otherAfter.json()).toEqual(otherBefore);
  } finally {
    await Promise.allSettled(contexts.map((context) => context.close()));
    try { await removeTestUsers(createdIds); }
    finally { await closeDb(); }
  }
});
