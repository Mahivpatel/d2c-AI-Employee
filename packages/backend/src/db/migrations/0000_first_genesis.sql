CREATE TABLE IF NOT EXISTS "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"agent_name" text NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"inputs_snapshot" jsonb NOT NULL,
	"intermediate_calculations" jsonb NOT NULL,
	"proposals" jsonb NOT NULL,
	"confidence_score" double precision DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "facts" (
	"fact_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"source" text NOT NULL,
	"entity_type" text NOT NULL,
	"connector_version" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"amount_inr" double precision DEFAULT 0 NOT NULL,
	"currency_original" text DEFAULT 'INR' NOT NULL,
	"fx_rate_used" double precision DEFAULT 1 NOT NULL,
	"dimensions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raw_id" text NOT NULL,
	"raw_payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "merchants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchants_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"connector" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"rows_upserted" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"status" text DEFAULT 'running' NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "facts" ADD CONSTRAINT "facts_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sync_logs" ADD CONSTRAINT "sync_logs_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_agent_runs_merchant_status" ON "agent_runs" ("merchant_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_agent_runs_agent_name" ON "agent_runs" ("merchant_id","agent_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_facts_merchant_source_type" ON "facts" ("merchant_id","source","entity_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_facts_occurred_at" ON "facts" ("occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ix_facts_source_raw_id" ON "facts" ("source","raw_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_facts_dimensions_gin" ON "facts" ("dimensions");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_sync_logs_merchant_connector" ON "sync_logs" ("merchant_id","connector");