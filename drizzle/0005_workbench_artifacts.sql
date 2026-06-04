ALTER TABLE "artifacts" RENAME COLUMN "chat_id" TO "created_in_chat_id";--> statement-breakpoint
ALTER TABLE "artifacts" DROP CONSTRAINT "artifacts_chat_id_chats_id_fk";--> statement-breakpoint
DROP INDEX "artifacts_chat_id_idx";--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "workbench_id" uuid;--> statement-breakpoint
UPDATE "artifacts"
SET "workbench_id" = "chats"."workbench_id"
FROM "chats"
WHERE "artifacts"."created_in_chat_id" = "chats"."id";--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_created_in_chat_id_chats_id_fk" FOREIGN KEY ("created_in_chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_workbench_id_workbenches_id_fk" FOREIGN KEY ("workbench_id") REFERENCES "public"."workbenches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifacts_workbench_id_idx" ON "artifacts" USING btree ("workbench_id");--> statement-breakpoint
CREATE INDEX "artifacts_created_in_chat_id_idx" ON "artifacts" USING btree ("created_in_chat_id");
