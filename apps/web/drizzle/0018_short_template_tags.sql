-- Shorter tags in templates and file name patterns: d.pageGroups is d.pgs and {d.pageGroup.x} is {d.pg.x}.
-- The plural first, and whole words only, so a name such as d.pageGroupX is left as it is.
CREATE FUNCTION pg_temp.spooldoc_short_tags(text text) RETURNS text AS $$
  SELECT regexp_replace(regexp_replace(text, '\md\.pageGroups\M', 'd.pgs', 'g'), '\md\.pageGroup\M', 'd.pg', 'g')
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint

-- `render.templates[].source` of each HTML template. Word templates are files; scripts/rename-word-tags.mjs renames their tags.
CREATE FUNCTION pg_temp.spooldoc_short_render(render jsonb) RETURNS jsonb AS $$
  SELECT jsonb_set(render, '{templates}', coalesce(jsonb_agg(
    CASE
      WHEN t->>'kind' = 'html' AND jsonb_typeof(t->'source') = 'string'
        THEN jsonb_set(t, '{source}', to_jsonb(pg_temp.spooldoc_short_tags(t->>'source')))
      ELSE t
    END
    ORDER BY e.ord), '[]'::jsonb))
  FROM jsonb_array_elements(render->'templates') WITH ORDINALITY AS e(t, ord)
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint

-- A whole spec, a draft or a version: its templates and its definition's file name pattern.
CREATE FUNCTION pg_temp.spooldoc_short_spec(spec jsonb) RETURNS jsonb AS $$
  SELECT CASE WHEN jsonb_typeof(spec->'render'->'templates') = 'array' THEN jsonb_set(spec, '{render}', pg_temp.spooldoc_short_render(spec->'render')) ELSE spec END
    || CASE
      WHEN jsonb_typeof(spec->'extract'->'definition') = 'string'
        THEN jsonb_build_object('extract', (spec->'extract') || jsonb_build_object('definition', pg_temp.spooldoc_short_tags(spec->'extract'->>'definition')))
      ELSE '{}'::jsonb
    END
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint

UPDATE "jobs" SET "draft" = pg_temp.spooldoc_short_spec("draft") WHERE "draft"::text ~ '\md\.pageGroup';--> statement-breakpoint
-- Versions never change, except for this one rewrite of their tags.
ALTER TABLE "job_versions" DISABLE TRIGGER "job_versions_immutable";--> statement-breakpoint
UPDATE "job_versions" SET "spec" = pg_temp.spooldoc_short_spec("spec") WHERE "spec"::text ~ '\md\.pageGroup';--> statement-breakpoint
ALTER TABLE "job_versions" ENABLE TRIGGER "job_versions_immutable";
