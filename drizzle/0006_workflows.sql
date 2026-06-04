CREATE TYPE "public"."workflow_origin" AS ENUM('builtin', 'user', 'fork');--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workbench_id" uuid,
	"owner_user_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"definition" jsonb NOT NULL,
	"origin" "workflow_origin" DEFAULT 'user' NOT NULL,
	"from_workflow_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"builtin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_workbench_id_workbenches_id_fk" FOREIGN KEY ("workbench_id") REFERENCES "public"."workbenches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflows_workbench_id_idx" ON "workflows" USING btree ("workbench_id");--> statement-breakpoint
CREATE INDEX "workflows_owner_user_id_idx" ON "workflows" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "workflows_builtin_idx" ON "workflows" USING btree ("builtin");--> statement-breakpoint
ALTER TABLE "workbenches" ADD COLUMN "active_workflow_id" uuid;--> statement-breakpoint
ALTER TABLE "workbenches" ADD CONSTRAINT "workbenches_active_workflow_id_workflows_id_fk" FOREIGN KEY ("active_workflow_id") REFERENCES "public"."workflows"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workbenches_active_workflow_id_idx" ON "workbenches" USING btree ("active_workflow_id");--> statement-breakpoint
INSERT INTO "workflows" ("id", "name", "description", "definition", "origin", "builtin", "version") VALUES (
  '00000000-0000-4000-8000-00000000aaaa',
  'Ship a PR-ready feature',
  'Built-in workflow: intake → plan → build → reviewer sign-off → ship. The opinionated default that just works.',
  '{
    "id": "wf-builtin-fullstack",
    "name": "Ship a PR-ready feature",
    "tag": "Most used · just works",
    "desc": "Intake → plan → build → reviewer sign-off → ship.",
    "origin": { "kind": "builtin" },
    "builtin": true,
    "planning": { "cut": "by_role", "clarifyThreshold": 0.6, "maxClarifyQuestions": 3 },
    "version": 1,
    "updatedAt": "2026-06-04T00:00:00Z",
    "stages": [
      { "id": "intake", "name": "Intake", "icon": "inbox", "desc": "Capture the goal in plain language.", "kind": "intake", "seats": [], "gate": { "kind": "none" }, "fixed": true },
      { "id": "plan", "name": "Plan", "icon": "layers", "desc": "Facilitator breaks the goal into parallel tasks.", "kind": "plan", "seats": [], "gate": { "kind": "none" } },
      { "id": "build", "name": "Build", "icon": "code", "desc": "Implementers write the code concurrently.", "kind": "work", "seats": [ { "ref": { "kind": "role", "role": "implementer" }, "brief": "Implement scoped code changes per HandoffCard." } ], "gate": { "kind": "none" } },
      { "id": "review", "name": "Review", "icon": "eye", "desc": "Reviewer checks quality and surfaces concerns.", "kind": "review", "seats": [ { "ref": { "kind": "role", "role": "reviewer" }, "brief": "Critique correctness, accessibility, and obvious UX issues." } ], "gate": { "kind": "reviewer_signoff", "reviewer": { "kind": "role", "role": "reviewer" }, "blockOn": "open_comments" } },
      { "id": "ship", "name": "Ship", "icon": "rocket", "desc": "Aggregate and present the result.", "kind": "ship", "seats": [], "gate": { "kind": "none" } }
    ]
  }'::jsonb,
  'builtin',
  true,
  1
);
