import type { JWT } from "next-auth/jwt";
import type { NextAuthConfig } from "next-auth";
import { displayAccountName } from "./account-profile";

export type SessionAccount = { id: string; name: string; lastName: string | null; email: string; role: string; sessionVersion: number };
export function accountAuthCallbacks(find: (id: string) => Promise<SessionAccount | undefined>): NonNullable<NextAuthConfig["callbacks"]> {
  return {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.sessionVersion = user.sessionVersion;
      }
      // Auth.js executes this for every auth() overload, including wrapped handlers.
      return refreshAccountToken(token, find);
    },
    session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        session.user.role = token.role === "admin" ? "admin" : "teacher";
        session.user.sessionVersion = token.sessionVersion!;
      }
      return session;
    },
  };
}
export async function refreshAccountToken(token: JWT, find: (id: string) => Promise<SessionAccount | undefined>): Promise<JWT | null> {
  if (!token.sub || !Number.isInteger(token.sessionVersion) || Number(token.sessionVersion) < 1) return null;
  const user = await find(token.sub);
  if (!user || user.sessionVersion !== token.sessionVersion) return null;
  return { ...token, name: displayAccountName(user.name, user.lastName), email: user.email, role: user.role === "admin" ? "admin" : "teacher" };
}
