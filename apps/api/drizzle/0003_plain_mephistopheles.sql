CREATE TABLE "claim_events" (
	"id" text PRIMARY KEY NOT NULL,
	"claim_id" text NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text,
	"actor_name" text,
	"kind" text NOT NULL,
	"message" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claim_events" ADD CONSTRAINT "claim_events_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_events" ADD CONSTRAINT "claim_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_events" ADD CONSTRAINT "claim_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claim_events_claim_created" ON "claim_events" USING btree ("claim_id","created_at");