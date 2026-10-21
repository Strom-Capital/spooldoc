CREATE TABLE "run_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"splf_key" text NOT NULL,
	"destination_id" uuid,
	"page_group_index" integer,
	"document" text NOT NULL,
	"to" text DEFAULT '' NOT NULL,
	"test" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"sent_in_run" bigint,
	"message_id" text,
	"error" text,
	"detail" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_deliveries_status_check" CHECK ("run_deliveries"."status" in ('sent', 'failed', 'already_sent'))
);
--> statement-breakpoint
ALTER TABLE "destinations" DROP CONSTRAINT "destinations_kind_check";--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "smtp_host" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "smtp_port" integer;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "smtp_security" text DEFAULT 'starttls' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "smtp_user" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "smtp_password_enc" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "mail_from" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "mail_from_name" text;--> statement-breakpoint
ALTER TABLE "run_deliveries" ADD CONSTRAINT "run_deliveries_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_deliveries" ADD CONSTRAINT "run_deliveries_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_deliveries" ADD CONSTRAINT "run_deliveries_destination_id_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destinations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "run_deliveries_document_idx" ON "run_deliveries" USING btree ("job_id","splf_key","document");--> statement-breakpoint
CREATE INDEX "run_deliveries_run_idx" ON "run_deliveries" USING btree ("run_id");--> statement-breakpoint
ALTER TABLE "destinations" ADD CONSTRAINT "destinations_kind_check" CHECK ("destinations"."kind" in ('spooldoc', 'ifs', 'email'));--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_smtp_security_check" CHECK ("settings"."smtp_security" in ('tls', 'starttls', 'none'));--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_smtp_port_check" CHECK ("settings"."smtp_port" between 1 and 65535);