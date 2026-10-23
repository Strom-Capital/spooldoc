CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"title" text NOT NULL,
	"error" text,
	"path" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution" jsonb,
	"open_sent_at" timestamp with time zone,
	"resolve_sent_at" timestamp with time zone,
	"run_id" uuid,
	"runs" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "alerts_kind_check" CHECK ("alerts"."kind" in ('run', 'server', 'job', 'queue'))
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "alert_to" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "alerts_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "alert_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "alert_error" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "alert_error_detail" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "alert_error_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_open_key_idx" ON "alerts" USING btree ("key") WHERE "alerts"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "alerts_resolved_idx" ON "alerts" USING btree ("resolved_at");