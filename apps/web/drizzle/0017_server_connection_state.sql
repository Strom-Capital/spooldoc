ALTER TABLE "servers" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "error_since" timestamp with time zone;--> statement-breakpoint
UPDATE "servers" SET "error_since" = "last_checked_at" WHERE "last_error" IS NOT NULL;
