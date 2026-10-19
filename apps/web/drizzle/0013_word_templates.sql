CREATE TABLE "template_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"content" "bytea" NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "template_files" ADD CONSTRAINT "template_files_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- A template file never changes: a job version keeps pointing at the exact file it ran
-- with. Only created_by may change, to null, when the user who uploaded it is deleted.
CREATE FUNCTION template_files_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.id = OLD.id AND NEW.name = OLD.name AND NEW.content_type = OLD.content_type AND NEW.size = OLD.size
    AND NEW.content = OLD.content AND NEW.created_at = OLD.created_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'template files cannot be changed' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER template_files_immutable
  BEFORE UPDATE ON template_files
  FOR EACH ROW EXECUTE FUNCTION template_files_immutable();
