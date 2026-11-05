import { validateReviewedAnswers } from "@/lib/exam-roster";

const SCALE = BigInt(10_000);
const MAX_RULE_VALUE_SCALED = BigInt(10) ** BigInt(18) - BigInt(1);

export type ScoringRule = {
  pointsCorrect: string;
  pointsWrong: string;
  pointsBlank: string;
  maxScore: string;
};

export type ScoreSummary = {
  correct: number;
  wrong: number;
  blank: number;
  rawScore: string;
  score: string;
};

export const DEFAULT_SCORING_RULE: ScoringRule = {
  pointsCorrect: "1.0000",
  pointsWrong: "0.0000",
  pointsBlank: "0.0000",
  maxScore: "10.0000",
};

function toScaled(value: unknown): bigint | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  const source = String(value).trim();
  const match = /^([+-]?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(source);
  if (!match) return null;
  const exponent = Number(match[4] ?? 0);
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 32) return null;
  const fraction = match[3] ?? "";
  const digits = BigInt(`${match[2]}${fraction}` || "0");
  const power = 4 + exponent - fraction.length;
  let scaled: bigint;
  if (power >= 0) scaled = digits * (BigInt(10) ** BigInt(power));
  else {
    const divisor = BigInt(10) ** BigInt(-power);
    if (digits % divisor !== BigInt(0)) return null;
    scaled = digits / divisor;
  }
  if (match[1] === "-") scaled = -scaled;
  return scaled;
}

function fixed(value: bigint, decimals: number) {
  const scale = BigInt(10) ** BigInt(decimals);
  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(decimals, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export function validateScoringRule(value: unknown): { success: true; rule: ScoringRule } | { success: false; message: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { success: false, message: "La regla de puntuación no es válida." };
  const rule = value as Record<string, unknown>;
  const keys = ["pointsCorrect", "pointsWrong", "pointsBlank", "maxScore"];
  if (Object.keys(rule).some((key) => !keys.includes(key)) || keys.some((key) => !(key in rule))) {
    return { success: false, message: "Indica los cuatro valores de puntuación y ningún campo adicional." };
  }
  const pointsCorrect = toScaled(rule.pointsCorrect);
  const pointsWrong = toScaled(rule.pointsWrong);
  const pointsBlank = toScaled(rule.pointsBlank);
  const maxScore = toScaled(rule.maxScore);
  if ([pointsCorrect, pointsWrong, pointsBlank, maxScore].some((item) => item === null)) {
    return { success: false, message: "Los valores deben ser decimales finitos con un máximo de cuatro decimales." };
  }
  if ([pointsCorrect!, pointsWrong!, pointsBlank!, maxScore!].some((item) => item > MAX_RULE_VALUE_SCALED || item < -MAX_RULE_VALUE_SCALED)) {
    return { success: false, message: "Un valor de la regla excede el límite permitido." };
  }
  if (pointsCorrect! <= BigInt(0) || pointsWrong! > BigInt(0) || pointsBlank! > BigInt(0) || maxScore! <= BigInt(0)) {
    return { success: false, message: "El acierto y la nota máxima deben ser positivos; fallos y blancos no pueden dar puntos positivos." };
  }
  return {
    success: true,
    rule: {
      pointsCorrect: fixed(pointsCorrect!, 4),
      pointsWrong: fixed(pointsWrong!, 4),
      pointsBlank: fixed(pointsBlank!, 4),
      maxScore: fixed(maxScore!, 4),
    },
  };
}

function roundHalfUp(numerator: bigint, denominator: bigint) {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return quotient + (remainder * BigInt(2) >= denominator ? BigInt(1) : BigInt(0));
}

export function calculateScore(input: {
  answers: unknown;
  answerKey: Array<{ questionNo: number; correctOption: string }>;
  numQuestions: number;
  numOptions: number;
  rule: unknown;
}): { success: true; summary: ScoreSummary } | { success: false; message: string } {
  if (!Number.isInteger(input.numQuestions) || input.numQuestions < 1 || input.numQuestions > 100 || !Number.isInteger(input.numOptions) || input.numOptions < 2 || input.numOptions > 26) {
    return { success: false, message: "La configuración del examen no es válida." };
  }
  const normalizedRule = validateScoringRule(input.rule);
  if (!normalizedRule.success) return normalizedRule;
  const normalizedAnswers = validateReviewedAnswers(input.answers, input.numQuestions, input.numOptions);
  if (!normalizedAnswers.success) return normalizedAnswers;
  if (!Array.isArray(input.answerKey) || input.answerKey.length !== input.numQuestions) {
    return { success: false, message: "La clave validada no cubre todas las preguntas." };
  }
  const key = new Map<number, string>();
  for (const entry of input.answerKey) {
    if (!Number.isInteger(entry.questionNo) || entry.questionNo < 1 || entry.questionNo > input.numQuestions || key.has(entry.questionNo)) {
      return { success: false, message: "La clave contiene preguntas fuera de rango o repetidas." };
    }
    if (typeof entry.correctOption !== "string" || !/^[A-Z]$/.test(entry.correctOption) || entry.correctOption.charCodeAt(0) - 64 > input.numOptions) {
      return { success: false, message: "La clave contiene una opción fuera de rango." };
    }
    key.set(entry.questionNo, entry.correctOption);
  }
  if (key.size !== input.numQuestions) return { success: false, message: "La clave está incompleta." };

  let correct = 0;
  let wrong = 0;
  let blank = 0;
  for (const answer of normalizedAnswers.answers) {
    if (answer.optionIndex === null) blank += 1;
    else if (String.fromCharCode(65 + answer.optionIndex) === key.get(answer.questionNo)) correct += 1;
    else wrong += 1;
  }

  const rule = normalizedRule.rule;
  const correctPoints = toScaled(rule.pointsCorrect)!;
  const wrongPoints = toScaled(rule.pointsWrong)!;
  const blankPoints = toScaled(rule.pointsBlank)!;
  const maxScore = toScaled(rule.maxScore)!;
  const raw = BigInt(correct) * correctPoints + BigInt(wrong) * wrongPoints + BigInt(blank) * blankPoints;
  const maxRaw = BigInt(input.numQuestions) * correctPoints;
  const bounded = raw < BigInt(0) ? BigInt(0) : raw > maxRaw ? maxRaw : raw;
  const cents = roundHalfUp(bounded * maxScore * BigInt(100), maxRaw * SCALE);

  return {
    success: true,
    summary: {
      correct,
      wrong,
      blank,
      rawScore: fixed(raw, 4),
      score: fixed(cents, 2),
    },
  };
}
