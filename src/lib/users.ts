import { hash } from "@node-rs/argon2";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import type { z } from "zod";
import { registrationSchema } from "@/lib/validation";

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
