ALTER TABLE "settings" ADD COLUMN "mail_sender" text DEFAULT 'smtp' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "m365_tenant_id" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "m365_client_id" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "m365_secret_enc" text;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_mail_sender_check" CHECK ("settings"."mail_sender" in ('smtp', 'm365'));