CREATE TABLE "answer_key_items" (
	"exam_id" uuid NOT NULL,
	"question_no" integer NOT NULL,
	"correct_option" varchar(26) NOT NULL,
	"llm_confidence" real,
	"edited_by_teacher" boolean DEFAULT false NOT NULL,
	CONSTRAINT "answer_key_items_exam_id_question_no_pk" PRIMARY KEY("exam_id","question_no")
);
--> statement-breakpoint
ALTER TABLE "answer_key_items" ADD CONSTRAINT "answer_key_items_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;