ALTER TABLE "run_deliveries" ADD COLUMN "route" integer;--> statement-breakpoint
-- A job had one destination: `destination: { destinationId, email, webhook }`. It now has
-- routes, and becomes one route with no conditions to that destination, with the same email
-- and webhook parts. A job with no destination yet gets one route with none.
CREATE FUNCTION pg_temp.spooldoc_routes(destination jsonb) RETURNS jsonb AS $$
  SELECT jsonb_build_object('routes', jsonb_build_array(jsonb_build_object(
    'when', '[]'::jsonb,
    'destinations', CASE
      WHEN jsonb_typeof(destination->'destinationId') = 'string' THEN jsonb_build_array(jsonb_build_object(
        'destinationId', destination->'destinationId',
        'email', coalesce(destination->'email', 'null'::jsonb),
        'webhook', coalesce(destination->'webhook', 'null'::jsonb)
      ))
      ELSE '[]'::jsonb
    END
  )))
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint

-- A spec without routes yet.
CREATE FUNCTION pg_temp.spooldoc_without_routes(spec jsonb) RETURNS boolean AS $$
  SELECT jsonb_typeof(spec) = 'object'
    AND NOT coalesce(jsonb_typeof(spec->'destination') = 'object' AND spec->'destination' ? 'routes', false)
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint

UPDATE "jobs" SET "draft" = jsonb_set("draft", '{destination}', pg_temp.spooldoc_routes("draft"->'destination'))
  WHERE pg_temp.spooldoc_without_routes("draft");--> statement-breakpoint
-- Versions never change, except for this one rewrite of their shape.
ALTER TABLE "job_versions" DISABLE TRIGGER "job_versions_immutable";--> statement-breakpoint
UPDATE "job_versions" SET "spec" = jsonb_set("spec", '{destination}', pg_temp.spooldoc_routes("spec"->'destination'))
  WHERE pg_temp.spooldoc_without_routes("spec");--> statement-breakpoint
ALTER TABLE "job_versions" ENABLE TRIGGER "job_versions_immutable";
