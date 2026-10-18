-- Job versions are history: once saved, a version never changes.
CREATE FUNCTION job_versions_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM jobs WHERE id = OLD.job_id) THEN
    -- The job itself is being deleted: its versions go with it.
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'job versions cannot be changed or deleted' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER job_versions_immutable
  BEFORE UPDATE OR DELETE ON job_versions
  FOR EACH ROW EXECUTE FUNCTION job_versions_immutable();
--> statement-breakpoint
-- The built-in destination: PDFs kept in Spooldoc for download.
INSERT INTO destinations (kind, name, builtin) VALUES ('spooldoc', 'Spooldoc PDF download', true);
--> statement-breakpoint
INSERT INTO settings (id) VALUES (1);
