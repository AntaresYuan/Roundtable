CREATE TYPE "public"."agent_role" AS ENUM('architect', 'planner', 'implementer', 'reviewer', 'fixer');--> statement-breakpoint
CREATE TYPE "public"."agent_session_status" AS ENUM('starting', 'running', 'completed', 'failed', 'interrupted');--> statement-breakpoint
CREATE TYPE "public"."artifact_kind" AS ENUM('file', 'diff', 'doc', 'preview', 'note');--> statement-breakpoint
CREATE TYPE "public"."dep_kind" AS ENUM('derives_from', 'replaces', 'references');--> statement-breakpoint
CREATE TYPE "public"."handoff_scenario" AS ENUM('dispatch', 'agent_handoff', 'join_group', 'cross_chat');--> statement-breakpoint
CREATE TYPE "public"."message_author_type" AS ENUM('user', 'orchestrator', 'agent', 'system');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('draft', 'streaming', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "agent_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"chat_id" uuid NOT NULL,
	"adapter_id" text NOT NULL,
	"role" "agent_role" NOT NULL,
	"cwd" text NOT NULL,
	"status" "agent_session_status" DEFAULT 'starting' NOT NULL,
	"mcp_servers" jsonb,
	"allowed_tools" jsonb,
	"budget" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "artifact_deps" (
	"from_artifact_id" uuid NOT NULL,
	"to_artifact_id" uuid NOT NULL,
	"kind" "dep_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_deps_from_artifact_id_to_artifact_id_kind_pk" PRIMARY KEY("from_artifact_id","to_artifact_id","kind"),
	CONSTRAINT "artifact_deps_no_self_dep" CHECK ("artifact_deps"."from_artifact_id" <> "artifact_deps"."to_artifact_id")
);
--> statement-breakpoint
CREATE TABLE "artifact_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"artifact_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"parent_version" integer,
	"snapshot" jsonb NOT NULL,
	"diff" text,
	"created_by_agent_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"chat_id" uuid NOT NULL,
	"kind" "artifact_kind" NOT NULL,
	"title" text NOT NULL,
	"owner_agent_id" text NOT NULL,
	"current_version" integer DEFAULT 0 NOT NULL,
	"uri" text,
	"preview" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chats" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"workspace_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_agents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"role" "agent_role",
	"avatar" text,
	"system_prompt" text NOT NULL,
	"capabilities" jsonb NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "handoffs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"chat_id" uuid NOT NULL,
	"from_agent_id" text NOT NULL,
	"to_agent_id" text NOT NULL,
	"scenario" "handoff_scenario" NOT NULL,
	"user_intent" text NOT NULL,
	"task_brief" text NOT NULL,
	"pinned_messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"roles_in_group" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"relevant_artifacts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"card" jsonb NOT NULL,
	"full_history_ref" text NOT NULL,
	"generated_by" text DEFAULT 'orchestrator' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"chat_id" uuid NOT NULL,
	"author_type" "message_author_type" NOT NULL,
	"author_id" text,
	"content" text NOT NULL,
	"status" "message_status" DEFAULT 'completed' NOT NULL,
	"event" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pinned_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"chat_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"pinned_by_user_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pinned_messages_position_cap" CHECK ("pinned_messages"."position" >= 0 and "pinned_messages"."position" < 10)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text,
	"email" varchar(320) NOT NULL,
	"email_verified_at" timestamp with time zone,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_deps" ADD CONSTRAINT "artifact_deps_from_artifact_id_artifacts_id_fk" FOREIGN KEY ("from_artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_deps" ADD CONSTRAINT "artifact_deps_to_artifact_id_artifacts_id_fk" FOREIGN KEY ("to_artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_agents" ADD CONSTRAINT "custom_agents_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pinned_messages" ADD CONSTRAINT "pinned_messages_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pinned_messages" ADD CONSTRAINT "pinned_messages_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pinned_messages" ADD CONSTRAINT "pinned_messages_pinned_by_user_id_users_id_fk" FOREIGN KEY ("pinned_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_sessions_chat_id_started_at_idx" ON "agent_sessions" USING btree ("chat_id","started_at");--> statement-breakpoint
CREATE INDEX "agent_sessions_adapter_id_idx" ON "agent_sessions" USING btree ("adapter_id");--> statement-breakpoint
CREATE INDEX "artifact_deps_from_artifact_id_idx" ON "artifact_deps" USING btree ("from_artifact_id");--> statement-breakpoint
CREATE INDEX "artifact_deps_to_artifact_id_idx" ON "artifact_deps" USING btree ("to_artifact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_versions_artifact_id_version_idx" ON "artifact_versions" USING btree ("artifact_id","version");--> statement-breakpoint
CREATE INDEX "artifact_versions_artifact_id_idx" ON "artifact_versions" USING btree ("artifact_id");--> statement-breakpoint
CREATE INDEX "artifacts_chat_id_idx" ON "artifacts" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "artifacts_owner_agent_id_idx" ON "artifacts" USING btree ("owner_agent_id");--> statement-breakpoint
CREATE INDEX "chats_owner_user_id_idx" ON "chats" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chats_workspace_path_idx" ON "chats" USING btree ("workspace_path");--> statement-breakpoint
CREATE INDEX "custom_agents_owner_user_id_idx" ON "custom_agents" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "handoffs_chat_id_created_at_idx" ON "handoffs" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE INDEX "handoffs_to_agent_id_idx" ON "handoffs" USING btree ("to_agent_id");--> statement-breakpoint
CREATE INDEX "messages_chat_id_created_at_idx" ON "messages" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pinned_messages_chat_position_idx" ON "pinned_messages" USING btree ("chat_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "pinned_messages_chat_message_idx" ON "pinned_messages" USING btree ("chat_id","message_id");--> statement-breakpoint
CREATE INDEX "pinned_messages_chat_id_idx" ON "pinned_messages" USING btree ("chat_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");