import { z } from "zod";

const optionalText = (max: number) => z.string().trim().max(max).nullable().transform((value) => value || null).optional();

export const accountPatchSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  lastName: optionalText(100),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()).optional(),
  institution: optionalText(160),
  department: optionalText(160),
  currentPassword: z.string().min(1).max(128).optional(),
  newPassword: z.string().min(12).max(128).optional(),
  confirmPassword: z.string().max(128).optional(),
}).strict().superRefine((data, ctx) => {
  if (![data.name, data.lastName, data.email, data.institution, data.department, data.newPassword].some((value) => value !== undefined)) {
    ctx.addIssue({ code: "custom", message: "Indica al menos un campo que modificar." });
  }
  if (data.newPassword !== undefined && (!data.currentPassword || data.newPassword !== data.confirmPassword)) {
    ctx.addIssue({ code: "custom", message: "Indica la contrasena actual y confirma la nueva contrasena.", path: ["confirmPassword"] });
  }
  if (data.confirmPassword !== undefined && data.newPassword === undefined) {
    ctx.addIssue({ code: "custom", message: "Indica la nueva contrasena.", path: ["newPassword"] });
  }
});
export type AccountRecord = { id: string; name: string; lastName: string | null; email: string; institution: string | null; department: string | null; passwordHash: string; sessionVersion: number; role: string };
export type AccountProfile = Pick<AccountRecord, "id" | "name" | "lastName" | "email" | "institution" | "department">;
export type AccountChanges = Partial<Pick<AccountRecord, "name" | "lastName" | "email" | "institution" | "department" | "passwordHash">>;
export type AccountDependencies = {
  find(id: string): Promise<AccountRecord | undefined>;
  commit(previous: AccountRecord, changes: AccountChanges, revoke: boolean): Promise<AccountProfile | "duplicate" | undefined>;
  checkRateLimit(key: string, ip: string): Promise<boolean>;
  clearRateLimit(key: string, ip: string): Promise<void>;
  verify(hash: string, password: string): Promise<boolean>;
  hash(password: string): Promise<string>;
};
export function displayAccountName(name: string, lastName: string | null) {
  const first = name.trim().replace(/\s+/g, " ");
  const last = lastName?.trim().replace(/\s+/g, " ");
  if (!last) return first;
  const normalized = first.toLocaleLowerCase("es");
  const suffix = last.toLocaleLowerCase("es");
  return normalized === suffix || normalized.endsWith(` ${suffix}`) ? first : `${first} ${last}`;
}

export function publicAccountProfile(user: AccountProfile): AccountProfile {
  const { id, name, lastName, email, institution, department } = user;
  return { id, name, lastName, email, institution, department };
}

export type AccountPatchResult =
  | { status: "updated"; profile: AccountProfile; reauthenticate: boolean }
  | { status: "invalid" | "unauthorized" | "forbidden" | "rate_limited" | "conflict" | "duplicate" };

export async function applyAccountPatch(deps: AccountDependencies, id: string, version: number, input: unknown, ip: string): Promise<AccountPatchResult> {
  const parsed = accountPatchSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid" };
  const data = parsed.data;
  const user = await deps.find(id);
  if (!user || user.sessionVersion !== version) return { status: "unauthorized" };
  const revoke = (data.email !== undefined && data.email !== user.email) || data.newPassword !== undefined;
  const rateKey = `account:${id}`;
  if (revoke) {
    if (!data.currentPassword) return { status: "invalid" };
    if (!await deps.checkRateLimit(rateKey, ip)) return { status: "rate_limited" };
    let valid = false;
    try { valid = await deps.verify(user.passwordHash, data.currentPassword); } catch { /* Credencial invalida. */ }
    if (!valid) return { status: "forbidden" };
    await deps.clearRateLimit(rateKey, ip);
  }
  const changes: AccountChanges = {};
  for (const field of ["name", "lastName", "email", "institution", "department"] as const) {
    if (data[field] !== undefined) Object.assign(changes, { [field]: data[field] });
  }
  if (data.newPassword !== undefined) changes.passwordHash = await deps.hash(data.newPassword);
  const profile = await deps.commit(user, changes, revoke);
  if (profile === "duplicate") return { status: "duplicate" };
  if (!profile) return { status: "conflict" };
  return { status: "updated", profile, reauthenticate: revoke };
}
