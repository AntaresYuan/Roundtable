ALTER TYPE "public"."artifact_kind" ADD VALUE 'code' BEFORE 'file';--> statement-breakpoint
ALTER TYPE "public"."artifact_kind" ADD VALUE 'web_app' BEFORE 'doc';--> statement-breakpoint
ALTER TYPE "public"."artifact_kind" ADD VALUE 'markdown' BEFORE 'doc';--> statement-breakpoint
ALTER TYPE "public"."artifact_kind" ADD VALUE 'mermaid' BEFORE 'doc';--> statement-breakpoint
ALTER TYPE "public"."artifact_kind" ADD VALUE 'html' BEFORE 'doc';--> statement-breakpoint
ALTER TYPE "public"."artifact_kind" ADD VALUE 'spec' BEFORE 'doc';