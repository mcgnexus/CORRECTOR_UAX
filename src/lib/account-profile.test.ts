import assert from "node:assert/strict";
import test from "node:test";
import { accountPatchSchema, displayAccountName, publicAccountProfile, applyAccountPatch, type AccountRecord, type AccountDependencies } from "./account-profile";

const record: AccountRecord = { id: "owner", name: "Ana", lastName: "Garcia", email: "ana@test.invalid", institution: null, department: null, passwordHash: "old-hash", sessionVersion: 1, role: "teacher" };

function setup(overrides: Partial<AccountDependencies> = {}) {
  let stored = { ...record };
  let attempts = 0;
  let verifications = 0;
  const dependencies: AccountDependencies = {
    find: async (id) => id === stored.id ? { ...stored } : undefined,
    commit: async (previous, changes, revoke) => {
      if (stored.sessionVersion !== previous.sessionVersion || stored.passwordHash !== previous.passwordHash || stored.email !== previous.email) return undefined;
      stored = { ...stored, ...changes, sessionVersion: stored.sessionVersion + Number(revoke) };
      return publicAccountProfile(stored);
    },
    checkRateLimit: async () => { attempts++; return true; },
    clearRateLimit: async () => {},
    verify: async (_hash, password) => { verifications++; return password === "current-password"; },
    hash: async () => "new-hash",
    ...overrides,
  };
  return { dependencies, stored: () => stored, attempts: () => attempts, verifications: () => verifications };
}

test("perfil: normaliza correo/campos opcionales y rechaza privilegios o campos ajenos", () => {
  const result = accountPatchSchema.parse({ email: " NEW@TEST.INVALID ", lastName: " ", institution: null, department: " Dept " });
  assert.deepEqual(result, { email: "new@test.invalid", lastName: null, institution: null, department: "Dept" });
  for (const input of [{}, { role: "admin" }, { id: "other" }, { sessionVersion: 9 }, { name: "" }, { name: "x".repeat(101) }, { institution: "x".repeat(161) }, { lastName: "x".repeat(101) }, { currentPassword: "alone" }]) {
    assert.equal(accountPatchSchema.safeParse(input).success, false);
  }
});

test("contrasena: exige actual, confirmacion y politica 12-128", () => {
  const valid = { currentPassword: "current", newPassword: "new-password12", confirmPassword: "new-password12" };
  assert.equal(accountPatchSchema.safeParse(valid).success, true);
  for (const input of [{ ...valid, currentPassword: "" }, { ...valid, confirmPassword: "different" }, { ...valid, newPassword: "short", confirmPassword: "short" }, { ...valid, newPassword: "x".repeat(129), confirmPassword: "x".repeat(129) }]) {
    assert.equal(accountPatchSchema.safeParse(input).success, false);
  }
});

test("nombre visible no duplica apellidos legados ni divide nombres automaticamente", () => {
  assert.equal(displayAccountName(" Ana Garcia ", "Garcia"), "Ana Garcia");
  assert.equal(displayAccountName("Ana", "Garcia"), "Ana Garcia");
  assert.equal(displayAccountName("Ana GARCIA", "garcia"), "Ana GARCIA");
  assert.equal(displayAccountName("Ana Maria", null), "Ana Maria");
});

test("perfil publico excluye hash, rol y version", () => {
  assert.deepEqual(Object.keys(publicAccountProfile(record)).sort(), ["department", "email", "id", "institution", "lastName", "name"].sort());
});

test("actualiza perfil propio sin reautenticar ni revocar sesiones", async () => {
  const state = setup();
  const result = await applyAccountPatch(state.dependencies, "owner", 1, { name: "Ana Maria", institution: "Centro" }, "ip");
  assert.equal(result.status, "updated");
  if (result.status === "updated") assert.equal(result.reauthenticate, false);
  assert.equal(state.stored().name, "Ana Maria");
  assert.equal(state.stored().sessionVersion, 1);
  assert.equal(state.attempts(), 0);
  assert.equal(state.verifications(), 0);
});

test("no accede a otro usuario ni acepta sesion obsoleta o campos prohibidos", async () => {
  const { dependencies } = setup();
  assert.equal((await applyAccountPatch(dependencies, "other", 1, { name: "Other" }, "ip")).status, "unauthorized");
  assert.equal((await applyAccountPatch(dependencies, "owner", 2, { name: "Other" }, "ip")).status, "unauthorized");
  assert.equal((await applyAccountPatch(dependencies, "owner", 1, { role: "admin" }, "ip")).status, "invalid");
});

test("correo distinto exige contrasena actual y limita intentos antes de verificar", async () => {
  const state = setup();
  assert.equal((await applyAccountPatch(state.dependencies, "owner", 1, { email: "new@test.invalid" }, "ip")).status, "invalid");
  assert.equal((await applyAccountPatch(state.dependencies, "owner", 1, { email: "new@test.invalid", currentPassword: "wrong" }, "ip")).status, "forbidden");
  assert.equal(state.stored().email, record.email);
  const limited = setup({ checkRateLimit: async () => false });
  assert.equal((await applyAccountPatch(limited.dependencies, "owner", 1, { email: "new@test.invalid", currentPassword: "current-password" }, "ip")).status, "rate_limited");
  assert.equal(limited.verifications(), 0);
});

test("correo equivalente no revoca; correo nuevo y password revocan todas las sesiones", async () => {
  const state = setup();
  const equivalent = await applyAccountPatch(state.dependencies, "owner", 1, { email: " ANA@TEST.INVALID " }, "ip");
  assert.equal(equivalent.status, "updated");
  assert.equal(state.stored().sessionVersion, 1);
  const changed = await applyAccountPatch(state.dependencies, "owner", 1, { email: "new@test.invalid", currentPassword: "current-password", newPassword: "new-password12", confirmPassword: "new-password12" }, "ip");
  assert.equal(changed.status, "updated");
  if (changed.status === "updated") assert.equal(changed.reauthenticate, true);
  assert.equal(state.stored().sessionVersion, 2);
  assert.equal(state.stored().passwordHash, "new-hash");
  assert.equal((await applyAccountPatch(state.dependencies, "owner", 1, { name: "Old session" }, "ip")).status, "unauthorized");
});

test("conflicto concurrente no acepta credencial antigua; duplicado es explicito", async () => {
  const conflict = setup({ commit: async () => undefined });
  const input = { email: "new@test.invalid", currentPassword: "current-password" };
  assert.equal((await applyAccountPatch(conflict.dependencies, "owner", 1, input, "ip")).status, "conflict");
  const duplicate = setup({ commit: async () => "duplicate" });
  assert.equal((await applyAccountPatch(duplicate.dependencies, "owner", 1, input, "ip")).status, "duplicate");
});

test("hash malformado falla cerrado y no escribe", async () => {
  const state = setup({ verify: async () => { throw new Error("bad hash"); } });
  assert.equal((await applyAccountPatch(state.dependencies, "owner", 1, { email: "new@test.invalid", currentPassword: "current-password" }, "ip")).status, "forbidden");
  assert.equal(state.stored().sessionVersion, 1);
});

test("fallo del rate limiter no devuelve error despues de cambiar credenciales", async () => {
  const state = setup({ clearRateLimit: async () => { throw new Error("rate limiter unavailable"); } });
  await assert.rejects(applyAccountPatch(state.dependencies, "owner", 1, { email: "new@test.invalid", currentPassword: "current-password" }, "ip"));
  assert.equal(state.stored().email, record.email);
  assert.equal(state.stored().sessionVersion, 1);
});
