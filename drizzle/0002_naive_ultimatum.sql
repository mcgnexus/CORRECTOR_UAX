CREATE TABLE "exam_matrix_profiles" (
	"exam_id" uuid PRIMARY KEY NOT NULL,
	"bubbles" jsonb NOT NULL,
	"bubble_radius" real NOT NULL,
	"rows_per_block" integer NOT NULL,
	"blocks" integer NOT NULL,
	"options_per_block" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exam_matrix_profiles" ADD CONSTRAINT "exam_matrix_profiles_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;