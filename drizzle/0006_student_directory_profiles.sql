CREATE TABLE "student_imports" (
	"owner_id" uuid NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_imports_owner_id_fingerprint_pk" PRIMARY KEY("owner_id","fingerprint")
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"dni" varchar(20),
	"email" varchar(254),
	"academic_code" varchar(100),
	"groups" text[] DEFAULT '{}'::text[] NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exam_students" ALTER COLUMN "dni" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_students" ADD COLUMN "student_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_name" varchar(100);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "institution" varchar(160);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "department" varchar(160);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "session_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" varchar(16) DEFAULT 'teacher' NOT NULL;--> statement-breakpoint
ALTER TABLE "student_imports" ADD CONSTRAINT "student_imports_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "students_owner_dni_unique" ON "students" USING btree ("owner_id","dni");--> statement-breakpoint
CREATE UNIQUE INDEX "students_owner_code_unique" ON "students" USING btree ("owner_id","academic_code");--> statement-breakpoint
CREATE INDEX "students_owner_name_idx" ON "students" USING btree ("owner_id","name");--> statement-breakpoint
ALTER TABLE "exam_students" ADD CONSTRAINT "exam_students_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exam_students_exam_student_unique" ON "exam_students" USING btree ("exam_id","student_id");--> statement-breakpoint
CREATE INDEX "exam_students_student_idx" ON "exam_students" USING btree ("student_id");
--> statement-breakpoint
-- Backfill keeps enrollment UUIDs/results intact. Invalid legacy documents remain
-- in the enrollment and are recorded as metadata, never silently corrected.
WITH normalized AS (
  SELECT es.id, es.exam_id, es.name, e.owner_id, upper(regexp_replace(coalesce(es.dni, ''), '\s+', '', 'g')) AS document
  FROM exam_students es JOIN exams e ON e.id = es.exam_id
), checked AS (
  SELECT *, CASE WHEN document ~ '^([0-9]{8}|[XYZ][0-9]{7})[A-Z]$' THEN
    right(document, 1) = substr('TRWAGMYFPDXBNJZSQVHLCKE',
      (translate(left(document, length(document)-1), 'XYZ', '012')::bigint % 23)::integer + 1, 1)
    ELSE false END AS valid FROM normalized
), safe AS (
  SELECT c.*, (valid AND NOT EXISTS (
    SELECT 1 FROM checked other WHERE other.owner_id = c.owner_id AND other.document = c.document AND other.id <> c.id
      AND (other.exam_id = c.exam_id OR lower(btrim(other.name)) <> lower(btrim(c.name)))
  )) AS reusable FROM checked c
), identities AS (
  SELECT *, CASE WHEN reusable THEN first_value(id) OVER (PARTITION BY owner_id, document ORDER BY id)
    ELSE id END AS directory_id FROM safe
)
INSERT INTO students (id, owner_id, name, dni, metadata)
SELECT DISTINCT ON (directory_id) directory_id, owner_id, name,
  CASE WHEN reusable THEN document ELSE NULL END,
  CASE WHEN NOT reusable AND document <> '' THEN jsonb_build_object('Documento legado', document) ELSE '{}'::jsonb END
FROM identities ORDER BY directory_id, id
ON CONFLICT DO NOTHING;
--> statement-breakpoint
WITH normalized AS (
  SELECT es.id, e.owner_id, upper(regexp_replace(coalesce(es.dni, ''), '\s+', '', 'g')) AS document
  FROM exam_students es JOIN exams e ON e.id = es.exam_id
)
UPDATE exam_students es SET student_id = coalesce(
  (SELECT s.id FROM students s JOIN normalized n ON n.owner_id = s.owner_id AND n.document = s.dni WHERE n.id = es.id),
  (SELECT s.id FROM students s WHERE s.id = es.id)
) WHERE es.student_id IS NULL;
--> statement-breakpoint
UPDATE exam_students SET dni = NULL WHERE btrim(coalesce(dni, '')) = '';
