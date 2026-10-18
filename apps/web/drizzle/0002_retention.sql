ALTER TABLE "settings" ADD COLUMN "retention_days" integer DEFAULT 90 NOT NULL;--> statement-breakpoint
CREATE INDEX "runs_finished_idx" ON "runs" USING btree ("finished_at");--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_retention_check" CHECK ("settings"."retention_days" between 1 and 3650);