import assert from "node:assert/strict";
import test from "node:test";
import NextAuth from "next-auth";
import { encode } from "next-auth/jwt";
import { NextRequest } from "next/server";
import { accountAuthCallbacks } from "./account-session";

test("NextAuth wrapped handler rejects legacy and revoked cookies", async () => {
  const secret = "account-handler-test-only-not-a-deployment-secret";
  const salt = "authjs.session-token";
  let version = 2;
  const { auth, handlers, signIn, signOut } = NextAuth({
    secret, trustHost: true, providers: [], basePath: "/api/auth",
    session: { strategy: "jwt" },
    callbacks: accountAuthCallbacks(async () => ({ id: "owner", name: "Ana", lastName: null, email: "ana@test.invalid", role: "teacher", sessionVersion: version })),
  });
  assert.equal(typeof handlers.GET, "function");
  assert.equal(typeof signIn, "function");
  assert.equal(typeof signOut, "function");
  const wrapped = auth((request) => Response.json({ id: request.auth?.user?.id ?? null }, { status: request.auth?.user?.id ? 200 : 401 }));
  async function request(sessionVersion?: number) {
    const jwt = await encode({ token: { sub: "owner", sessionVersion }, secret, salt });
    const response = await wrapped(new NextRequest("http://localhost/api/protected", { headers: { host: "localhost", "x-forwarded-proto": "http", cookie: `${salt}=${jwt}` } }), { params: Promise.resolve({}) });
    assert.ok(response instanceof Response);
    return response;
  }
  assert.equal((await request(2)).status, 200);
  assert.equal((await request()).status, 401);
  version++;
  assert.equal((await request(2)).status, 401);
});
