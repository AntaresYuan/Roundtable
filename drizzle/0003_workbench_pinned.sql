CREATE TABLE "workbench_pinned_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workbench_id" uuid NOT NULL,
	"content" text NOT NULL,
	"pinned_by_user_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workbench_pinned_messages_position_cap" CHECK ("position" >= 0 AND "position" < 10)
);
--> statement-breakpoint
ALTER TABLE "workbench_pinned_messages" ADD CONSTRAINT "workbench_pinned_messages_workbench_id_workbenches_id_fk" FOREIGN KEY ("workbench_id") REFERENCES "public"."workbenches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench_pinned_messages" ADD CONSTRAINT "workbench_pinned_messages_pinned_by_user_id_users_id_fk" FOREIGN KEY ("pinned_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workbench_pinned_messages_workbench_position_idx" ON "workbench_pinned_messages" USING btree ("workbench_id","position");--> statement-breakpoint
CREATE INDEX "workbench_pinned_messages_workbench_id_idx" ON "workbench_pinned_messages" USING btree ("workbench_id");
