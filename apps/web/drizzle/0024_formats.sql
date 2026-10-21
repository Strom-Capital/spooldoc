ALTER TABLE "settings" ADD COLUMN "number_format" text DEFAULT 'en-us' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "date_format" text DEFAULT 'YYYY-MM-DD' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_currency_check" CHECK ("settings"."currency" ~ '^[A-Z]{3}$');