CREATE TABLE "ai_providers" (
	"provider" text PRIMARY KEY NOT NULL,
	"api_key_enc" text,
	"model" text,
	"effort" text DEFAULT 'provider-default' NOT NULL,
	"base_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_providers_provider_check" CHECK ("ai_providers"."provider" in ('anthropic', 'google', 'openai', 'openrouter', 'gateway', 'local')),
	CONSTRAINT "ai_providers_effort_check" CHECK ("ai_providers"."effort" in ('provider-default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'))
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "ai_provider" text;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_ai_provider_check" CHECK ("settings"."ai_provider" in ('anthropic', 'google', 'openai', 'openrouter', 'gateway', 'local'));