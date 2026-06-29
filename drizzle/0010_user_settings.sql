CREATE TABLE "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"default_language" text DEFAULT 'auto' NOT NULL,
	"default_workflow_id" uuid,
	"approval_mode" text DEFAULT 'always_ask' NOT NULL,
	"run_style" text DEFAULT 'balanced' NOT NULL,
	"learn_preference_suggestions" boolean DEFAULT true NOT NULL,
	"use_saved_preferences_in_handoffs" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
