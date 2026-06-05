CREATE TABLE "user_skills" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"trigger_hint" text NOT NULL,
	"body" text NOT NULL,
	"source_chat_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_skills" ADD CONSTRAINT "user_skills_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_skills" ADD CONSTRAINT "user_skills_source_chat_id_chats_id_fk" FOREIGN KEY ("source_chat_id") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_skills_owner_user_id_idx" ON "user_skills" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_skills_owner_name_idx" ON "user_skills" USING btree ("owner_user_id","name");
