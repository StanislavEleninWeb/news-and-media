CREATE TYPE "public"."engagement_kind" AS ENUM('click', 'dwell', 'reaction', 'save', 'share');--> statement-breakpoint
CREATE TABLE "engagement_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_key" text NOT NULL,
	"user_id" uuid,
	"article_id" uuid NOT NULL,
	"kind" "engagement_kind" NOT NULL,
	"dwell_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "llm_usage" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "engagement_events" ADD CONSTRAINT "engagement_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_events" ADD CONSTRAINT "engagement_events_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "engagement_actor_idx" ON "engagement_events" USING btree ("actor_key","created_at");--> statement-breakpoint
CREATE INDEX "engagement_created_idx" ON "engagement_events" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "llm_usage" ADD CONSTRAINT "llm_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "llm_usage_user_idx" ON "llm_usage" USING btree ("user_id","created_at");