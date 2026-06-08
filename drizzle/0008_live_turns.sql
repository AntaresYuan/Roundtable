CREATE TYPE "public"."live_turn_status" AS ENUM('done', 'error');--> statement-breakpoint
CREATE TYPE "public"."live_turn_approval_status" AS ENUM('pending', 'approved', 'changes_requested');--> statement-breakpoint
CREATE TYPE "public"."live_turn_dispatch_status" AS ENUM('not_started', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "live_turns" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" uuid NOT NULL,
	"message" text NOT NULL,
	"status" "live_turn_status" NOT NULL,
	"provider" text,
	"model" text,
	"pm_message" text,
	"needs_approval" boolean,
	"approval_status" "live_turn_approval_status",
	"approved_at" timestamp with time zone,
	"dispatch_status" "live_turn_dispatch_status",
	"dispatch_adapter" text,
	"dispatched_at" timestamp with time zone,
	"dispatch" jsonb,
	"artifacts" jsonb,
	"dispatch_stage" text,
	"dispatch_error" text,
	"dispatch_workspace_path" text,
	"intake" jsonb,
	"plan" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "live_turns" ADD CONSTRAINT "live_turns_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "live_turns_chat_id_created_at_idx" ON "live_turns" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE INDEX "live_turns_status_idx" ON "live_turns" USING btree ("status");
