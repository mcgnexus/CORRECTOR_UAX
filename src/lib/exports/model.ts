import { DEFAULT_SCORING_RULE, scoreBreakdown, type ScoreBreakdown, type ScoringRule } from "@/lib/scoring";

export type ExportExam = {
  id: string;
  title: string;
  subject: string | null;
  numQuestions: number;
  numOptions: number;
  status: "draft" | "key_pending" | "key_validated";
};

export type ExportKeyItem = { questionNo: number; correctOption: string };

export type ExportStudent = {
  id: string;
  name: string;
  dni: string | null;
  savedAt: Date | string | null;
  answers: Array<{ questionNo: number; optionIndex: number | null }> | null;
  correct: number | null;
  wrong: number | null;
  blank: number | null;
  rawScore: string | null;
  score: string | null;
};

export type ExportBundle = { exam: ExportExam; key: ExportKeyItem[]; students: ExportStudent[]; rule?: ScoringRule };
export type ExportState = "Corregido" | "Pendiente" | "Pendiente de clave" | "Pendiente de cálculo";

export type ResultExportRow = {
  student: ExportStudent;
  state: ExportState;
  answers: string[];
  correct: number | null;
  wrong: number | null;
  blank: number | null;
  rawScore: string | null;
  score: string | null;
};

export function isKeyValidated(bundle: ExportBundle) {
  if (bundle.exam.status !== "key_validated" || bundle.key.length !== bundle.exam.numQuestions) return false;
  const key = new Map(bundle.key.map((answer) => [answer.questionNo, answer.correctOption]));
  if (key.size !== bundle.exam.numQuestions) return false;
  for (let questionNo = 1; questionNo <= bundle.exam.numQuestions; questionNo += 1) {
    const option = key.get(questionNo);
    if (!option || !/^[A-Z]$/.test(option) || option.charCodeAt(0) - 64 > bundle.exam.numOptions) return false;
  }
  return true;
}

export function resultExportRows(bundle: ExportBundle): ResultExportRow[] {
  const validated = isKeyValidated(bundle);
  const answerLabels = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return bundle.students.map((student) => {
    if (!student.answers) {
      return { student, state: "Pendiente", answers: Array(bundle.exam.numQuestions).fill(""), correct: null, wrong: null, blank: null, rawScore: null, score: null };
    }
    const byQuestion = new Map(student.answers.map((answer) => [answer.questionNo, answer.optionIndex]));
    const answers = Array.from({ length: bundle.exam.numQuestions }, (_, index) => {
      const option = byQuestion.get(index + 1);
      if (option === undefined) return "";
      return option === null ? "En blanco" : answerLabels[option] ?? "";
    });
    if (!validated) {
      return { student, state: "Pendiente de clave", answers, correct: null, wrong: null, blank: null, rawScore: null, score: null };
    }
    if (student.score === null) {
      return { student, state: "Pendiente de cálculo", answers, correct: null, wrong: null, blank: null, rawScore: null, score: null };
    }
    return {
      student,
      state: "Corregido",
      answers,
      correct: student.correct,
      wrong: student.wrong,
      blank: student.blank,
      rawScore: student.rawScore,
      score: student.score,
    };
  });
}

export function resultExportSummary(rows: ResultExportRow[]) {
  const corrected = rows.filter((row) => row.state === "Corregido");
  const pending = rows.filter((row) => row.state === "Pendiente").length;
  const keyPending = rows.filter((row) => row.state === "Pendiente de clave").length;
  const scores = corrected.flatMap((row) => row.score === null ? [] : [Number(row.score)]);
  return {
    total: rows.length,
    corrected: corrected.length,
    pending,
    keyPending,
    calculationPending: rows.filter((row) => row.state === "Pendiente de cálculo").length,
    mean: scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null,
  };
}

export function keyExportRows(bundle: ExportBundle) {
  const byQuestion = new Map(bundle.key.map((answer) => [answer.questionNo, answer.correctOption]));
  return Array.from({ length: bundle.exam.numQuestions }, (_, index) => ({
    questionNo: index + 1,
    correctOption: byQuestion.get(index + 1) ?? null,
  }));
}

export function safeFilename(value: string) {
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const slug = normalized.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return slug || "examen";
}

export type ReportOutcome = "Acierto" | "Fallo" | "Blanco" | "Sin entrega" | "Pendiente de clave" | "Pendiente de cálculo";

export type ReportQuestionRow = {
  questionNo: number;
  given: string;
  correct: string | null;
  outcome: ReportOutcome;
  points: string | null;
};

export type ReportStudentRow = {
  student: ExportStudent;
  state: ExportState;
  questions: ReportQuestionRow[];
  breakdown: ScoreBreakdown | null;
};

const ANSWER_LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function reportStudentRows(bundle: ExportBundle): ReportStudentRow[] {
  const rows = resultExportRows(bundle);
  const validated = isKeyValidated(bundle);
  const key = new Map(bundle.key.map((item) => [item.questionNo, item.correctOption]));
  const rule = bundle.rule ?? DEFAULT_SCORING_RULE;

  return rows.map((row) => {
    const byQuestion = new Map((row.student.answers ?? []).map((answer) => [answer.questionNo, answer.optionIndex]));
    const questions = Array.from({ length: bundle.exam.numQuestions }, (_, index) => {
      const questionNo = index + 1;
      const correct = validated ? key.get(questionNo) ?? null : null;
      if (!row.student.answers) {
        return { questionNo, given: "Sin entrega", correct, outcome: "Sin entrega" as const, points: null };
      }
      const option = byQuestion.get(questionNo);
      const given = option === undefined ? "—" : option === null ? "En blanco" : ANSWER_LABELS[option] ?? "—";
      if (!validated) {
        return { questionNo, given, correct, outcome: "Pendiente de clave" as const, points: null };
      }
      if (row.state === "Pendiente de cálculo") {
        return { questionNo, given, correct: null, outcome: "Pendiente de cálculo" as const, points: null };
      }
      if (option === undefined) {
        return { questionNo, given, correct, outcome: "Sin entrega" as const, points: null };
      }
      if (option === null) {
        return { questionNo, given, correct, outcome: "Blanco" as const, points: rule.pointsBlank };
      }
      const outcome = given === correct ? "Acierto" as const : "Fallo" as const;
      return {
        questionNo,
        given,
        correct,
        outcome,
        points: outcome === "Acierto" ? rule.pointsCorrect : rule.pointsWrong,
      };
    });

    let breakdown: ScoreBreakdown | null = null;
    if (row.state === "Corregido" && row.correct !== null && row.wrong !== null && row.blank !== null) {
      const computed = scoreBreakdown({
        correct: row.correct,
        wrong: row.wrong,
        blank: row.blank,
        numQuestions: bundle.exam.numQuestions,
        rule,
      });
      if (computed.success) breakdown = computed.breakdown;
    }

    return { student: row.student, state: row.state, questions, breakdown };
  });
}

export function reportCalculationRows(row: ReportStudentRow): Array<[string, string]> {
  const breakdown = row.breakdown;
  if (!breakdown) return [["Cálculo", "Pendiente: la entrega no está corregida o falta la clave validada."]];
  return [
    [`Aciertos: ${breakdown.correct} × ${breakdown.pointsCorrect}`, breakdown.correctSubtotal],
    [`Fallos: ${breakdown.wrong} × ${breakdown.pointsWrong}`, breakdown.wrongSubtotal],
    [`Blancos: ${breakdown.blank} × ${breakdown.pointsBlank}`, breakdown.blankSubtotal],
    ["Suma bruta", breakdown.rawScore],
    [`Bruto acotado (0 … ${breakdown.maxRaw})`, breakdown.boundedRaw],
    [`Nota = bruto acotado / ${breakdown.maxRaw} × ${breakdown.maxScore}`, breakdown.score],
  ];
}
