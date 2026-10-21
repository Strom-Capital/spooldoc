-- The pieces a definition cuts out of a spooled file are page groups, and a job's outputs are templates.
ALTER TABLE "run_outputs" RENAME TO "run_files";--> statement-breakpoint
ALTER TABLE "run_files" RENAME CONSTRAINT "run_outputs_pkey" TO "run_files_pkey";--> statement-breakpoint
ALTER TABLE "run_files" RENAME CONSTRAINT "run_outputs_run_id_runs_id_fk" TO "run_files_run_id_runs_id_fk";--> statement-breakpoint
ALTER INDEX "run_outputs_name_idx" RENAME TO "run_files_name_idx";--> statement-breakpoint
ALTER TABLE "run_files" RENAME COLUMN "document_index" TO "page_group_index";--> statement-breakpoint
ALTER TABLE "run_files" RENAME COLUMN "output_index" TO "template_index";--> statement-breakpoint
ALTER TABLE "run_files" RENAME COLUMN "output" TO "template";--> statement-breakpoint
UPDATE "run_files" SET "template" = 'Template 1' WHERE "template" IS NULL;--> statement-breakpoint
ALTER TABLE "run_files" ALTER COLUMN "template" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" RENAME COLUMN "documents" TO "page_groups";--> statement-breakpoint
-- The extract step's note in the job log: "6 documents" is "6 page groups".
UPDATE "runs" SET "steps" = (
  SELECT jsonb_agg(CASE
    WHEN s->>'step' = 'extract' AND s->>'note' ~ '^\d+ documents?$'
      THEN jsonb_set(s, '{note}', to_jsonb(regexp_replace(s->>'note', 'document(s?)$', 'page group\1')))
    ELSE s
  END ORDER BY e.ord)
  FROM jsonb_array_elements("steps") WITH ORDINALITY AS e(s, ord)
) WHERE jsonb_typeof("steps") = 'array' AND jsonb_array_length("steps") > 0;--> statement-breakpoint

-- Tags in templates and file name patterns: {d.doc.x} is {d.pageGroup.x}, d.documents is d.pageGroups, d.sample.splf is d.splf.
CREATE FUNCTION pg_temp.spooldoc_tags(text text) RETURNS text AS $$
  SELECT regexp_replace(regexp_replace(regexp_replace(text, '\md\.doc\M', 'd.pageGroup', 'g'), '\md\.documents\M', 'd.pageGroups', 'g'), '\md\.sample\.splf\M', 'd.splf', 'g')
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint

-- The XML key that marks one piece, `xml.document`, is `xml.pageGroup`. Only the key right
-- under the top-level `xml:`, in block or flow style, so a field named `document` keeps its name.
CREATE FUNCTION pg_temp.spooldoc_xml_key(yaml text) RETURNS text AS $$
DECLARE
  lines text[] := string_to_array(yaml, E'\n');
  inside boolean := false;
  indent text;
BEGIN
  FOR i IN 1 .. coalesce(array_length(lines, 1), 0) LOOP
    IF lines[i] ~ '^\s*(#.*)?$' THEN
      CONTINUE;
    ELSIF lines[i] ~ '^\S' THEN
      inside := lines[i] ~ '^xml\s*:\s*(#.*)?$';
      indent := NULL;
      IF lines[i] ~ '^xml\s*:\s*\{' THEN
        lines[i] := regexp_replace(lines[i], '^(xml\s*:\s*\{([^{}]*,)?\s*)document(\s*:)', '\1pageGroup\3');
      END IF;
    ELSIF inside THEN
      indent := coalesce(indent, substring(lines[i] from '^\s+'));
      IF substring(lines[i] from '^\s+') = indent THEN
        lines[i] := regexp_replace(lines[i], '^(\s+)document(\s*:)', '\1pageGroup\2');
      END IF;
    END IF;
  END LOOP;
  RETURN array_to_string(lines, E'\n');
END
$$ LANGUAGE plpgsql IMMUTABLE;--> statement-breakpoint

-- A definition: its tags and its XML key.
CREATE FUNCTION pg_temp.spooldoc_definition(yaml text) RETURNS text AS $$
  SELECT pg_temp.spooldoc_xml_key(pg_temp.spooldoc_tags(yaml))
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint

-- `render: { outputs: [{ id, label, template: { kind, source | fileId }, formats }] }` as
-- `render: { templates: [{ id, name, kind, source | fileId, formats }] }`.
CREATE FUNCTION pg_temp.spooldoc_render(render jsonb) RETURNS jsonb AS $$
  SELECT jsonb_build_object('templates', coalesce(jsonb_agg(
    jsonb_build_object('id', o->'id', 'name', o->'label', 'kind', o->'template'->'kind', 'formats', o->'formats')
    || CASE
      WHEN o->'template'->>'kind' = 'docx' THEN jsonb_build_object('fileId', o->'template'->'fileId')
      ELSE jsonb_build_object('source', CASE WHEN jsonb_typeof(o->'template'->'source') = 'string' THEN to_jsonb(pg_temp.spooldoc_tags(o->'template'->>'source')) ELSE 'null'::jsonb END)
    END
    ORDER BY e.ord), '[]'::jsonb))
  FROM jsonb_array_elements(render->'outputs') WITH ORDINALITY AS e(o, ord)
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint

-- A whole spec, a draft or a version.
CREATE FUNCTION pg_temp.spooldoc_spec(spec jsonb) RETURNS jsonb AS $$
  SELECT CASE WHEN spec->'render' ? 'outputs' THEN jsonb_set(spec, '{render}', pg_temp.spooldoc_render(spec->'render')) ELSE spec END
    || CASE
      WHEN jsonb_typeof(spec->'extract'->'definition') = 'string'
        THEN jsonb_build_object('extract', (spec->'extract') || jsonb_build_object('definition', pg_temp.spooldoc_definition(spec->'extract'->>'definition')))
      ELSE '{}'::jsonb
    END
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint

UPDATE "jobs" SET "draft" = pg_temp.spooldoc_spec("draft");--> statement-breakpoint
-- Versions never change, except for this one rewrite of their words.
ALTER TABLE "job_versions" DISABLE TRIGGER "job_versions_immutable";--> statement-breakpoint
UPDATE "job_versions" SET "spec" = pg_temp.spooldoc_spec("spec");--> statement-breakpoint
ALTER TABLE "job_versions" ENABLE TRIGGER "job_versions_immutable";--> statement-breakpoint

-- Saved chats call the tools by their old names (add_output, remove_output), so they start over.
DELETE FROM "job_chats";
