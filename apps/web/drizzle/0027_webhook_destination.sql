ALTER TABLE "destinations" DROP CONSTRAINT "destinations_kind_check";--> statement-breakpoint
ALTER TABLE "destinations" ADD COLUMN "secrets_enc" text;--> statement-breakpoint
ALTER TABLE "run_deliveries" ADD COLUMN "http_status" integer;--> statement-breakpoint
ALTER TABLE "run_deliveries" ADD COLUMN "attempts" integer;--> statement-breakpoint
ALTER TABLE "run_deliveries" ADD COLUMN "ms" integer;--> statement-breakpoint
ALTER TABLE "run_deliveries" ADD COLUMN "response" text;--> statement-breakpoint
ALTER TABLE "destinations" ADD CONSTRAINT "destinations_kind_check" CHECK ("destinations"."kind" in ('spooldoc', 'ifs', 'email', 'webhook'));