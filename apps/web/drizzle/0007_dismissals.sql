ALTER TABLE "jobs" ADD COLUMN "watch_error_dismissed" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "error_dismissed" text;