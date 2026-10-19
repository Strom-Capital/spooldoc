ALTER TABLE "settings" ADD COLUMN "ai_mask" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Masking was on by default before it became a setting. An install that already has
-- users keeps it on, so nothing starts sending values as printed without someone
-- choosing it. A new install has no users yet when its migrations run, and starts off.
UPDATE "settings" SET "ai_mask" = true WHERE EXISTS (SELECT 1 FROM "user");
