DROP INDEX IF EXISTS "ix_facts_source_raw_id";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ix_facts_merchant_source_raw_id" ON "facts" ("merchant_id","source","raw_id");--> statement-breakpoint
