ALTER TABLE "exams" DROP CONSTRAINT "exams_sheet_format_check";--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_sheet_format_check" CHECK ("exams"."sheet_format" = 'bubbles' or ("exams"."sheet_format" = 'uax-grid-40' and "exams"."num_options" = 4));
