CREATE TABLE "exam_result_answers" (
	"student_id" uuid NOT NULL,
	"question_no" integer NOT NULL,
	"selected_option" integer,
	CONSTRAINT "exam_result_answers_student_id_question_no_pk" PRIMARY KEY("student_id","question_no")
);
--> statement-breakpoint
CREATE TABLE "exam_results" (
	"student_id" uuid PRIMARY KEY NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exam_students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exam_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"dni" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exam_result_answers" ADD CONSTRAINT "exam_result_answers_student_id_exam_results_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."exam_results"("student_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_results" ADD CONSTRAINT "exam_results_student_id_exam_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."exam_students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_students" ADD CONSTRAINT "exam_students_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exam_students_exam_dni_unique" ON "exam_students" USING btree ("exam_id","dni");--> statement-breakpoint
CREATE INDEX "exam_students_exam_name_idx" ON "exam_students" USING btree ("exam_id","name");