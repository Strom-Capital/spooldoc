ALTER TABLE "run_outputs" ADD COLUMN "output" text;--> statement-breakpoint
ALTER TABLE "run_outputs" ADD COLUMN "output_index" integer DEFAULT 0 NOT NULL;