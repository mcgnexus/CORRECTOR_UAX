import {
  boolean,
  index,
  integer,
  jsonb,
  primaryKey,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const examStatus = pgEnum("exam_status", ["draft", "key_pending", "key_validated"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    email: varchar("email", { length: 254 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("users_email_lower_unique").on(sql`lower(${table.email})`)],
);

export const exams = pgTable(
  "exams",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 160 }).notNull(),
    subject: varchar("subject", { length: 160 }),
    numQuestions: integer("num_questions").notNull(),
    numOptions: integer("num_options").notNull().default(4),
    status: examStatus("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("exams_owner_created_idx").on(table.ownerId, table.createdAt),
    index("exams_owner_title_idx").on(table.ownerId, table.title),
  ],
);

export const answerKeyItems = pgTable(
  "answer_key_items",
  {
    examId: uuid("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    questionNo: integer("question_no").notNull(),
    correctOption: varchar("correct_option", { length: 26 }).notNull(),
    llmConfidence: real("llm_confidence"),
    editedByTeacher: boolean("edited_by_teacher").notNull().default(false),
  },
  (table) => [primaryKey({ columns: [table.examId, table.questionNo] })],
);

export const examMatrixProfiles = pgTable("exam_matrix_profiles", {
  examId: uuid("exam_id")
    .primaryKey()
    .references(() => exams.id, { onDelete: "cascade" }),
  bubbles: jsonb("bubbles")
    .$type<Array<{ questionNo: number; optionIndex: number; x: number; y: number }>>()
    .notNull(),
  bubbleRadius: real("bubble_radius").notNull(),
  rowsPerBlock: integer("rows_per_block").notNull(),
  blocks: integer("blocks").notNull(),
  optionsPerBlock: integer("options_per_block").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const examStudents = pgTable(
  "exam_students",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    examId: uuid("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    dni: varchar("dni", { length: 20 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("exam_students_exam_dni_unique").on(table.examId, table.dni),
    index("exam_students_exam_name_idx").on(table.examId, table.name),
  ],
);

export const examResults = pgTable("exam_results", {
  studentId: uuid("student_id")
    .primaryKey()
    .references(() => examStudents.id, { onDelete: "cascade" }),
  savedAt: timestamp("saved_at", { withTimezone: true }).defaultNow().notNull(),
});

export const examResultAnswers = pgTable(
  "exam_result_answers",
  {
    studentId: uuid("student_id")
      .notNull()
      .references(() => examResults.studentId, { onDelete: "cascade" }),
    questionNo: integer("question_no").notNull(),
    selectedOption: integer("selected_option"),
  },
  (table) => [primaryKey({ columns: [table.studentId, table.questionNo] })],
);

export const authAttempts = pgTable(
  "auth_attempts",
  {
    keyHash: varchar("key_hash", { length: 64 }).primaryKey(),
    attempts: integer("attempts").notNull().default(0),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
);
