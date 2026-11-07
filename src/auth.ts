import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { eq } from "drizzle-orm";
import { hash, verify } from "@node-rs/argon2";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { clearAuthRateLimit, checkAuthRateLimit, requestIp } from "@/lib/rate-limit";
import { credentialsSchema } from "@/lib/validation";
import { displayAccountName } from "@/lib/account-profile";
import { accountAuthCallbacks } from "@/lib/account-session";
import { findSessionAccount } from "@/lib/users";

const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

let dummyHashPromise: Promise<string> | undefined;

async function verifyDummyHash(password: string) {
  dummyHashPromise ??= hash("correctora-uax-dummy-password", ARGON2_OPTIONS);
  try {
    await verify(await dummyHashPromise, password);
  } catch {
    // Solo para igualar el tiempo de respuesta con el camino de usuario existente.
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Correo electrónico", type: "email" },
        password: { label: "Contraseña", type: "password" },
      },
      async authorize(credentials, request) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const ip = requestIp(request.headers);
        if (!(await checkAuthRateLimit(parsed.data.email, ip))) return null;

        const [user] = await getDb()
          .select({ id: users.id, name: users.name, lastName: users.lastName, email: users.email, passwordHash: users.passwordHash, role: users.role, sessionVersion: users.sessionVersion })
          .from(users)
          .where(eq(users.email, parsed.data.email))
          .limit(1);

        if (!user) {
          await verifyDummyHash(parsed.data.password);
          return null;
        }

        let passwordMatches = false;
        try {
          passwordMatches = await verify(user.passwordHash, parsed.data.password);
        } catch {
          return null;
        }

        if (!passwordMatches) return null;

        await clearAuthRateLimit(parsed.data.email, ip);
        return { id: user.id, name: displayAccountName(user.name, user.lastName), email: user.email, role: user.role === "admin" ? "admin" : "teacher", sessionVersion: user.sessionVersion };
      },
    }),
  ],
  callbacks: accountAuthCallbacks(findSessionAccount),
});
