CREATE TYPE "public"."device_platform" AS ENUM('ios', 'android');--> statement-breakpoint
CREATE TABLE "device_push_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"platform" "device_platform" NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_success_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_push_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "device_push_tokens" ADD CONSTRAINT "device_push_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_push_tokens_user_idx" ON "device_push_tokens" USING btree ("user_id");