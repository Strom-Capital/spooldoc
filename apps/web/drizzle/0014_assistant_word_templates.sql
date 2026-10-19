ALTER TABLE "template_files" ADD COLUMN "made_by" text DEFAULT 'upload' NOT NULL;--> statement-breakpoint
ALTER TABLE "template_files" ADD COLUMN "previous_id" uuid;--> statement-breakpoint
ALTER TABLE "template_files" ADD CONSTRAINT "template_files_made_by_check" CHECK ("template_files"."made_by" in ('upload', 'assistant'));--> statement-breakpoint
-- The new columns never change either. Only created_by may change, to null, when the
-- user who uploaded the file is deleted.
CREATE OR REPLACE FUNCTION template_files_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.id = OLD.id AND NEW.name = OLD.name AND NEW.content_type = OLD.content_type AND NEW.size = OLD.size
    AND NEW.content = OLD.content AND NEW.made_by = OLD.made_by AND NEW.previous_id IS NOT DISTINCT FROM OLD.previous_id
    AND NEW.created_at = OLD.created_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'template files cannot be changed' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
