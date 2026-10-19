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

-- Tags in templates and file name patterns: {d.doc.x} is {d.pageGroup.x}, d.documents is d.pageGroups, d.sample.splf is d.splf.
CREATE FUNCTION pg_temp.spooldoc_tags(text text) RETURNS text AS $$
  SELECT regexp_replace(regexp_replace(regexp_replace(text, '\md\.doc\M', 'd.pageGroup', 'g'), '\md\.documents\M', 'd.pageGroups', 'g'), '\md\.sample\.splf\M', 'd.splf', 'g')
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint

-- A definition: its tags, and the XML key that marks one piece, `document:`, is `pageGroup:`.
CREATE FUNCTION pg_temp.spooldoc_definition(yaml text) RETURNS text AS $$
  SELECT regexp_replace(pg_temp.spooldoc_tags(yaml), '^(\s+)document:', '\1pageGroup:', 'gn')
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
