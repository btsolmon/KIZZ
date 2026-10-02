-- Some databases already have `assignments.description` (added outside the
-- migrations), so only add what is missing.
ALTER TABLE "assignments" ADD COLUMN IF NOT EXISTS "description" text;--> statement-breakpoint
ALTER TABLE "class_materials" ADD COLUMN IF NOT EXISTS "is_submission" boolean DEFAULT false NOT NULL;