CREATE TABLE "workbenches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"workspace_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workbenches" ADD CONSTRAINT "workbenches_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workbenches_owner_user_id_idx" ON "workbenches" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workbenches_workspace_path_idx" ON "workbenches" USING btree ("workspace_path");--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "workbench_id" uuid;--> statement-breakpoint
INSERT INTO "workbenches" ("id", "owner_user_id", "name", "description", "workspace_path", "created_at", "updated_at")
SELECT gen_random_uuid(), "owner_user_id", "title" || ' workbench', 'Backfilled from chat "' || "title" || '" during spec 100 / issue #95 migration', "workspace_path", "created_at", "updated_at"
FROM "chats";--> statement-breakpoint
UPDATE "chats" SET "workbench_id" = (
  SELECT "workbenches"."id" FROM "workbenches"
  WHERE "workbenches"."workspace_path" = "chats"."workspace_path"
  LIMIT 1
);--> statement-breakpoint
ALTER TABLE "chats" ALTER COLUMN "workbench_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_workbench_id_workbenches_id_fk" FOREIGN KEY ("workbench_id") REFERENCES "public"."workbenches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
DROP INDEX IF EXISTS "chats_workspace_path_idx";--> statement-breakpoint
ALTER TABLE "chats" DROP COLUMN "workspace_path";--> statement-breakpoint
CREATE INDEX "chats_workbench_id_idx" ON "chats" USING btree ("workbench_id");
