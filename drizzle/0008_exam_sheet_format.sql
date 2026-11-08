ALTER TABLE "exam_matrix_profiles" ALTER COLUMN "bubbles" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_matrix_profiles" ALTER COLUMN "bubble_radius" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_matrix_profiles" ADD COLUMN "format" varchar(20) DEFAULT 'bubbles' NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_matrix_profiles" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_matrix_profiles" ADD COLUMN "uax_data" jsonb;--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "sheet_format" varchar(20) DEFAULT 'bubbles' NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_matrix_profiles" ADD CONSTRAINT "exam_matrix_profiles_shape_check" CHECK ("exam_matrix_profiles"."version" = 1 and (
    ("exam_matrix_profiles"."format" = 'bubbles' and "exam_matrix_profiles"."bubbles" is not null and "exam_matrix_profiles"."bubble_radius" is not null and "exam_matrix_profiles"."uax_data" is null)
    or ("exam_matrix_profiles"."format" = 'uax-grid-40' and "exam_matrix_profiles"."bubbles" is null and "exam_matrix_profiles"."bubble_radius" is null and "exam_matrix_profiles"."uax_data" is not null
      and coalesce(jsonb_typeof("exam_matrix_profiles"."uax_data"->'tables') = 'array' and jsonb_array_length("exam_matrix_profiles"."uax_data"->'tables') = 2, false)
      and "exam_matrix_profiles"."rows_per_block" = 20 and "exam_matrix_profiles"."blocks" = 2 and "exam_matrix_profiles"."options_per_block" = 4)));--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_sheet_format_check" CHECK ("exams"."sheet_format" = 'bubbles' or ("exams"."sheet_format" = 'uax-grid-40' and "exams"."num_questions" = 40 and "exams"."num_options" = 4));
