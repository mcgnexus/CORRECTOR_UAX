import { createHash } from "node:crypto";

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function hashReviewedRequest(value: {
  studentId: string;
  answers: unknown;
  replace: boolean;
  expectedVersion: number | null;
  expectedStructureVersion?: number;
}) {
  const answers = Array.isArray(value.answers)
    ? [...value.answers].sort((a, b) => {
      const questionA = a && typeof a === "object" ? Number((a as Record<string, unknown>).questionNo) : Number.NaN;
      const questionB = b && typeof b === "object" ? Number((b as Record<string, unknown>).questionNo) : Number.NaN;
      return Number.isFinite(questionA) && Number.isFinite(questionB) ? questionA - questionB : 0;
    })
    : value.answers;
  return createHash("sha256").update(stableStringify({ ...value, answers })).digest("hex");
}
