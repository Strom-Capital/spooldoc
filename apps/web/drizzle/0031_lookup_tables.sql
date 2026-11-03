CREATE TABLE "lookup_tables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"columns" jsonb NOT NULL,
	"rows" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lookup_tables_name_unique" UNIQUE("name"),
	CONSTRAINT "lookup_tables_name_check" CHECK ("lookup_tables"."name" ~ '^[a-z0-9][a-z0-9_-]{0,63}$')
);
