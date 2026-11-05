CREATE TABLE "idempotency_keys" (
	"owner_id" uuid NOT NULL,
	"exam_id" uuid NOT NULL,
	"key" varchar(36) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"student_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_owner_id_exam_id_key_pk" PRIMARY KEY("owner_id","exam_id","key")
);
--> statement-breakpoint
CREATE TABLE "scoring_rules" (
	"exam_id" uuid PRIMARY KEY NOT NULL,
	"points_correct" numeric(18, 4) NOT NULL,
	"points_wrong" numeric(18, 4) NOT NULL,
	"points_blank" numeric(18, 4) NOT NULL,
	"max_score" numeric(18, 4) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exam_results" ADD COLUMN "correct" integer;--> statement-breakpoint
ALTER TABLE "exam_results" ADD COLUMN "wrong" integer;--> statement-breakpoint
ALTER TABLE "exam_results" ADD COLUMN "blank" integer;--> statement-breakpoint
ALTER TABLE "exam_results" ADD COLUMN "raw_score" numeric(20, 4);--> statement-breakpoint
ALTER TABLE "exam_results" ADD COLUMN "score" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "exam_results" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
WITH result_counts AS (
	SELECT
		r.student_id,
		e.num_questions,
		count(a.question_no)::integer AS answer_count,
		count(k.question_no)::integer AS key_count,
		count(*) FILTER (WHERE a.selected_option IS NOT NULL AND chr(65 + a.selected_option) = k.correct_option)::integer AS correct,
		count(*) FILTER (WHERE a.selected_option IS NOT NULL AND k.correct_option IS NOT NULL AND chr(65 + a.selected_option) <> k.correct_option)::integer AS wrong,
		count(*) FILTER (WHERE a.question_no IS NOT NULL AND a.selected_option IS NULL)::integer AS blank
	FROM exam_results r
	JOIN exam_students s ON s.id = r.student_id
	JOIN exams e ON e.id = s.exam_id AND e.status = 'key_validated'
	LEFT JOIN exam_result_answers a ON a.student_id = r.student_id
	LEFT JOIN answer_key_items k ON k.exam_id = s.exam_id AND k.question_no = a.question_no
	GROUP BY r.student_id, e.num_questions
)
UPDATE exam_results r
SET correct = c.correct,
	wrong = c.wrong,
	blank = c.blank,
	raw_score = c.correct::numeric,
	score = round(c.correct::numeric / c.num_questions * 10, 2)
FROM result_counts c
WHERE r.student_id = c.student_id
	AND c.answer_count = c.num_questions
	AND c.key_count = c.num_questions;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_student_id_exam_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."exam_students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_rules" ADD CONSTRAINT "scoring_rules_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idempotency_keys_student_idx" ON "idempotency_keys" USING btree ("student_id");
