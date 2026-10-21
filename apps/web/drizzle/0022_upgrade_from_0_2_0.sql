-- Jobs saved by 0.2.0 have `render: { template, formats }`, or `render: { template, format }`
-- from before HTML output. 0016 and 0018 rewrite only `outputs` and `templates`, so these
-- become one HTML template, named as 0016 names the files of runs without one.
-- The template's text is kept as it is: Nunjucks from 0.2.0 is rewritten by hand.
CREATE FUNCTION pg_temp.spooldoc_v02_formats(render jsonb) RETURNS jsonb AS $$
  SELECT coalesce(jsonb_agg(f ORDER BY f = 'html'), '["pdf"]'::jsonb)
  FROM (
    SELECT DISTINCT f FROM jsonb_array_elements_text(CASE
      WHEN jsonb_typeof(render->'formats') = 'array' THEN render->'formats'
      WHEN jsonb_typeof(render->'format') = 'string' THEN jsonb_build_array(render->'format')
      ELSE '[]'::jsonb
    END) AS e(f)
    WHERE f IN ('pdf', 'html')
  ) AS d
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint

CREATE FUNCTION pg_temp.spooldoc_v02_render(render jsonb) RETURNS jsonb AS $$
  SELECT jsonb_build_object('templates', jsonb_build_array(jsonb_build_object(
    'id', 'template-1',
    'name', 'Template 1',
    'kind', 'html',
    'source', CASE WHEN jsonb_typeof(render->'template') = 'string' THEN render->'template' ELSE 'null'::jsonb END,
    'formats', pg_temp.spooldoc_v02_formats(CASE WHEN jsonb_typeof(render) = 'object' THEN render ELSE '{}'::jsonb END)
  )))
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint

-- A spec still in the 0.2.0 shape: render missing, empty or without `templates` and `outputs`.
CREATE FUNCTION pg_temp.spooldoc_v02_spec(spec jsonb) RETURNS boolean AS $$
  SELECT jsonb_typeof(spec) = 'object'
    AND NOT (jsonb_typeof(spec->'render') = 'object' AND (spec->'render' ? 'templates' OR spec->'render' ? 'outputs'))
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint

UPDATE "jobs" SET "draft" = jsonb_set("draft", '{render}', pg_temp.spooldoc_v02_render("draft"->'render'))
  WHERE pg_temp.spooldoc_v02_spec("draft");--> statement-breakpoint
-- Versions never change, except for this one rewrite of their shape.
ALTER TABLE "job_versions" DISABLE TRIGGER "job_versions_immutable";--> statement-breakpoint
UPDATE "job_versions" SET "spec" = jsonb_set("spec", '{render}', pg_temp.spooldoc_v02_render("spec"->'render'))
  WHERE pg_temp.spooldoc_v02_spec("spec");--> statement-breakpoint
ALTER TABLE "job_versions" ENABLE TRIGGER "job_versions_immutable";--> statement-breakpoint

-- 0.2.0 kept a failed sign-on only as text, and 0017 gave it no error code, so Spooldoc
-- would sign on again with the same password. The texts 0.2.0 wrote for a sign-on the
-- IBM i refused are marked as one, so sign-on stays paused until the password is edited.
UPDATE "servers" SET "error_code" = 'auth'
  WHERE "error_code" IS NULL
    AND "last_error" ~ '(is disabled on .+\. A security officer can enable it with CHGUSRPRF USRPRF\(.+\) STATUS\(\*ENABLED\)\.|has expired\. Set a new one on the IBM i, then enter it for the server on the Servers page\.|has no password \(PASSWORD\(\*NONE\)\), so it cannot sign on\. Use a user profile with a password\.|There is no user profile .+ on .+\. Check the user on the Servers page\.|did not accept the password for .+\. Check it on the Servers page; repeated wrong passwords can disable the profile\.|did not accept the user profile or password\. Check them on the Servers page\.)( \([A-Z0-9]+\))?$';
