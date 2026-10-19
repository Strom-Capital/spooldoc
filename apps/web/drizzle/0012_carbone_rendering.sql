ALTER TABLE "settings" ADD COLUMN "carbone_mode" text DEFAULT 'onprem' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "carbone_url" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "carbone_api_key_enc" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "carbone_key_enc" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "carbone_public_key" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "carbone_check" jsonb;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_carbone_mode_check" CHECK ("settings"."carbone_mode" in ('onprem', 'cloud'));