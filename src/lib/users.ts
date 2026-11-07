import { hash, verify } from "@node-rs/argon2";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import type { z } from "zod";
import { registrationSchema } from "@/lib/validation";
import { applyAccountPatch, type AccountDependencies } from "@/lib/account-profile";
import { checkAuthRateLimit, clearAuthRateLimit } from "@/lib/rate-limit";

export type RegistrationInput = z.input<typeof registrationSchema>;

export async function registerUser(input: RegistrationInput) {
  const data = registrationSchema.parse(input);
  const passwordHash = await hash(data.password, {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  const inserted = await getDb()
    .insert(users)
    .values({ name: data.name, email: data.email, passwordHash })
    .onConflictDoNothing()
    .returning({ id: users.id });

  return inserted.length > 0;
}

const profileColumns = {
  id: users.id, name: users.name, lastName: users.lastName, email: users.email,
  institution: users.institution, department: users.department,
};

export async function getAccountProfile(id: string, sessionVersion: number) {
  const [profile] = await getDb().select(profileColumns).from(users)
    .where(and(eq(users.id, id), eq(users.sessionVersion, sessionVersion))).limit(1);
  return profile;
}

export async function findSessionAccount(id: string) {
  const [user] = await getDb().select({
    id: users.id, name: users.name, lastName: users.lastName, email: users.email,
    role: users.role, sessionVersion: users.sessionVersion,
  }).from(users).where(eq(users.id, id)).limit(1);
  return user;
}

const accountDependencies: AccountDependencies = {
  async find(id) {
    const [user] = await getDb().select({ ...profileColumns, passwordHash: users.passwordHash, role: users.role, sessionVersion: users.sessionVersion })
      .from(users).where(eq(users.id, id)).limit(1);
    return user;
  },
  async commit(previous, changes, revoke) {
    try {
      return await getDb().transaction(async (tx) => {
        // CAS closes the gap between password verification and the write, including profile-only requests.
        const [profile] = await tx.update(users).set({
          ...changes,
          ...(revoke ? { sessionVersion: sql`${users.sessionVersion} + 1` } : {}),
        }).where(and(
          eq(users.id, previous.id), eq(users.sessionVersion, previous.sessionVersion),
          eq(users.passwordHash, previous.passwordHash), eq(users.email, previous.email),
        )).returning(profileColumns);
        return profile;
      });
    } catch (error) {
      const failure = error as { code?: string; cause?: { code?: string } };
      if (failure.code === "23505" || failure.cause?.code === "23505") return "duplicate";
      throw error;
    }
  },
  checkRateLimit: checkAuthRateLimit,
  clearRateLimit: clearAuthRateLimit,
  verify,
  hash: (password) => hash(password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 }),
};

export async function updateAccountProfile(id: string, sessionVersion: number, input: unknown, ip: string) {
  return applyAccountPatch(accountDependencies, id, sessionVersion, input, ip);
}
