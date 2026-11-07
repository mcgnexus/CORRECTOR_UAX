import assert from "node:assert/strict";
import test from "node:test";
import { accountAuthCallbacks, refreshAccountToken } from "./account-session";
import { Auth } from "@auth/core";
import { encode } from "next-auth/jwt";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const user = { id: "owner", name: "Ana Garcia", lastName: "Garcia", email: "new@test.invalid", role: "teacher" as const, sessionVersion: 2 };

test("JWT sin version, usuario borrado o version obsoleta se invalida", async () => {
  assert.equal(await refreshAccountToken({ sub: "owner" }, async () => user), null);
  assert.equal(await refreshAccountToken({ sub: "owner", sessionVersion: 1 }, async () => user), null);
  assert.equal(await refreshAccountToken({ sub: "owner", sessionVersion: 2 }, async () => undefined), null);
  assert.equal(await refreshAccountToken({ sessionVersion: 2 }, async () => user), null);
});

test("cada autenticacion consulta BD y refresca nombre/correo/rol, sin confiar en datos cliente", async () => {
  let reads = 0;
  const read = async () => { reads++; return user; };
  const token = { sub: "owner", sessionVersion: 2, name: "Old", email: "old@test.invalid", role: "admin" as const };
  const refreshed = await refreshAccountToken(token, read);
  assert.equal(refreshed?.name, "Ana Garcia");
  assert.equal(refreshed?.email, user.email);
  assert.equal(refreshed?.role, "teacher");
  await refreshAccountToken(token, read);
  assert.equal(reads, 2);
  assert.equal(await refreshAccountToken({ ...token, sessionVersion: 1 }, read), null);
});

test("dos sesiones del mismo usuario quedan revocadas tras incrementar version", async () => {
  let version = 2;
  const read = async () => ({ ...user, sessionVersion: version });
  const first = { sub: "owner", sessionVersion: 2 };
  const second = { ...first };
  assert.ok(await refreshAccountToken(first, read));
  assert.ok(await refreshAccountToken(second, read));
  version++;
  assert.equal(await refreshAccountToken(first, read), null);
  assert.equal(await refreshAccountToken(second, read), null);
});

test("Auth.js invalida cookie JWT en endpoint real y expone version solo si BD coincide", async () => {
  const secret = "account-session-test-only-not-a-deployment-secret";
  const salt = "authjs.session-token";
  let version = 2;
  const config = {
    secret, trustHost: true, providers: [], basePath: "/api/auth",
    session: { strategy: "jwt" as const },
    callbacks: accountAuthCallbacks(async () => ({ ...user, sessionVersion: version })),
  };
  async function session(token: { sub: string; sessionVersion?: number }) {
    const jwt = await encode({ token, secret, salt });
    const response = await Auth(new Request("http://localhost/api/auth/session", { headers: { cookie: `${salt}=${jwt}` } }), config);
    return { response, body: await response.json() };
  }
  assert.equal((await session({ sub: "owner" })).body, null);
  const active = await session({ sub: "owner", sessionVersion: 2 });
  assert.equal(active.body.user.id, "owner");
  assert.equal(active.body.user.name, "Ana Garcia");
  assert.equal(active.body.user.sessionVersion, 2);
  version++;
  const revoked = await session({ sub: "owner", sessionVersion: 2 });
  assert.equal(revoked.body, null);
  assert.match(revoked.response.headers.get("set-cookie") ?? "", /Max-Age=0/);
});

test("auth(handler) conserva su API y tampoco permite saltar la revocacion", () => {
  // NextAuth imports client-side Next contexts, incompatible with the suite's react-server condition.
  const result = spawnSync(process.execPath, ["--import", "tsx", "--test", fileURLToPath(new URL("./account-session-handler.fixture.ts", import.meta.url))], { encoding: "utf8", timeout: 30_000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
