import { z } from 'zod';
import { WorkflowSchema } from './workflow.js';

/**
 * Workflow templates (spec 130 / #148). A template packages an expert
 * software-engineering process so a novice can run it without designing a
 * workflow. It wraps an executable `Workflow` (unchanged — the orchestrator
 * still drives that) and adds the novice-facing layer:
 *
 * - product copy (`summary`, `bestFor`, `expectedOutput`);
 * - the minimum `requiredInputs` the launch flow collects (#151);
 * - per-stage guidance with the expected HandoffCard inputs/outputs (#149).
 *
 * Built-in templates live here as typed, schema-validated data — not UI
 * fixtures — so the UI, server, and orchestrator share one source of truth.
 */

/** A novice-facing input the Mission launch flow collects before starting. */
export const WorkflowTemplateInputSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  help: z.string().optional(),
  placeholder: z.string().optional(),
  required: z.boolean().default(true),
});
export type WorkflowTemplateInput = z.infer<typeof WorkflowTemplateInputSchema>;

/** Per-stage novice guidance plus the handoff contract between stages. */
export const WorkflowTemplateStageGuideSchema = z.object({
  stageId: z.string().min(1),
  intent: z.string().min(1),
  expectedHandoffInputs: z.array(z.string().min(1)).default([]),
  expectedHandoffOutputs: z.array(z.string().min(1)).default([]),
});
export type WorkflowTemplateStageGuide = z.infer<
  typeof WorkflowTemplateStageGuideSchema
>;

export const WorkflowTemplateSchema = z
  .object({
    templateId: z.string().min(1),
    name: z.string().min(1),
    tag: z.string().optional(),
    summary: z.string().min(1),
    bestFor: z.string().min(1),
    flagship: z.boolean().default(false),
    requiredInputs: z.array(WorkflowTemplateInputSchema).default([]),
    expectedOutput: z.string().min(1),
    workflow: WorkflowSchema,
    stageGuides: z.array(WorkflowTemplateStageGuideSchema).default([]),
  })
  .superRefine((template, ctx) => {
    const stageIds = new Set(template.workflow.stages.map((stage) => stage.id));
    const guided = new Set<string>();
    for (const guide of template.stageGuides) {
      guided.add(guide.stageId);
      if (!stageIds.has(guide.stageId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['stageGuides'],
          message: `stage guide references unknown stage "${guide.stageId}"`,
        });
      }
    }
    // Every stage must carry novice guidance — a template with an unexplained
    // stage is not novice-safe.
    for (const stage of template.workflow.stages) {
      if (!guided.has(stage.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['stageGuides'],
          message: `stage "${stage.id}" is missing a stage guide`,
        });
      }
    }
  });
export type WorkflowTemplate = z.infer<typeof WorkflowTemplateSchema>;

function defineTemplate(template: unknown): WorkflowTemplate {
  return WorkflowTemplateSchema.parse(template);
}

/**
 * Flagship template (#148): vague feature request → reviewed, delivered feature.
 * Stages: clarify → plan → split → implement → review → repair → deliver.
 */
export const FEATURE_BUILDER_TEMPLATE: WorkflowTemplate = defineTemplate({
  templateId: 'feature-builder',
  name: 'Feature Builder',
  tag: 'Flagship · just works',
  summary: 'Turn a vague feature request into a reviewed, working change.',
  bestFor: 'You know what you want built but not how to break it down or ship it.',
  flagship: true,
  expectedOutput: 'A reviewed implementation with a final delivery report.',
  requiredInputs: [
    { id: 'goal', label: 'What do you want to build?', placeholder: 'e.g. Add team invitations with email links', required: true },
    { id: 'context', label: 'Project / repo context', help: 'Where should the work happen and what already exists?', required: false },
    { id: 'constraints', label: 'Constraints', help: 'Anything the result must or must not do.', required: false },
    { id: 'output', label: 'Desired output', placeholder: 'e.g. A PR-ready change with tests', required: false },
  ],
  workflow: {
    id: 'feature-builder',
    name: 'Feature Builder',
    tag: 'Flagship · just works',
    desc: 'Clarify → plan → split → implement → review → repair → deliver.',
    origin: { kind: 'builtin' },
    builtin: true,
    planning: { cut: 'by_role', clarifyThreshold: 0.6, maxClarifyQuestions: 3 },
    version: 1,
    updatedAt: '2026-06-19T00:00:00Z',
    stages: [
      { id: 'clarify', name: 'Clarify', icon: 'inbox', desc: 'Pin down what the user actually wants.', kind: 'intake', seats: [], gate: { kind: 'user_approval' }, fixed: true },
      { id: 'plan', name: 'Plan', icon: 'layers', desc: 'Produce a technical plan.', kind: 'plan', seats: [{ ref: { kind: 'role', role: 'architect' }, brief: 'Draft a technical plan for the clarified goal.' }], gate: { kind: 'user_approval' } },
      { id: 'split', name: 'Split', icon: 'git-branch', desc: 'Break the plan into parallel tasks.', kind: 'custom', seats: [{ ref: { kind: 'role', role: 'planner' }, brief: 'Split the approved plan into scoped, parallel tasks.' }], gate: { kind: 'none' } },
      { id: 'implement', name: 'Implement', icon: 'code', desc: 'Build the scoped tasks.', kind: 'work', seats: [{ ref: { kind: 'role', role: 'implementer' }, brief: 'Implement scoped code changes per HandoffCard.' }], gate: { kind: 'none' } },
      { id: 'review', name: 'Review', icon: 'eye', desc: 'Check the deliverable.', kind: 'review', seats: [{ ref: { kind: 'role', role: 'reviewer' }, brief: 'Review correctness, tests, and risks.' }], gate: { kind: 'reviewer_signoff', reviewer: { kind: 'role', role: 'reviewer' }, blockOn: 'open_comments' } },
      { id: 'repair', name: 'Repair', icon: 'wrench', desc: 'Fix what review surfaced.', kind: 'custom', seats: [{ ref: { kind: 'role', role: 'fixer' }, brief: 'Resolve reviewer findings and failing tests.' }], gate: { kind: 'none' } },
      { id: 'deliver', name: 'Deliver', icon: 'rocket', desc: 'Assemble the final delivery report.', kind: 'ship', seats: [], gate: { kind: 'user_approval' } },
    ],
  },
  stageGuides: [
    { stageId: 'clarify', intent: 'We make sure we understand the request before any code is written.', expectedHandoffInputs: ['raw user request'], expectedHandoffOutputs: ['clarified goal', 'acceptance criteria'] },
    { stageId: 'plan', intent: 'An architect turns the goal into a technical plan you approve.', expectedHandoffInputs: ['clarified goal', 'acceptance criteria'], expectedHandoffOutputs: ['technical plan'] },
    { stageId: 'split', intent: 'The plan becomes concrete, parallel tasks.', expectedHandoffInputs: ['approved technical plan'], expectedHandoffOutputs: ['task breakdown'] },
    { stageId: 'implement', intent: 'Implementers build each task.', expectedHandoffInputs: ['task breakdown'], expectedHandoffOutputs: ['code artifacts'] },
    { stageId: 'review', intent: 'A reviewer checks the work before it can be delivered.', expectedHandoffInputs: ['code artifacts'], expectedHandoffOutputs: ['review findings', 'sign-off or blocking comments'] },
    { stageId: 'repair', intent: 'We resolve anything review flagged.', expectedHandoffInputs: ['review findings'], expectedHandoffOutputs: ['fixed code artifacts'] },
    { stageId: 'deliver', intent: 'You get a final report and decide whether to accept.', expectedHandoffInputs: ['reviewed artifacts'], expectedHandoffOutputs: ['final delivery report'] },
  ],
});

/** Bug report → diagnosis → fix → verification. */
export const BUG_FIXER_TEMPLATE: WorkflowTemplate = defineTemplate({
  templateId: 'bug-fixer',
  name: 'Bug Fixer',
  tag: 'Diagnose & fix',
  summary: 'Go from a bug report to a verified fix.',
  bestFor: 'Something is broken and you need it diagnosed and fixed safely.',
  expectedOutput: 'A verified fix with an explanation of the root cause.',
  requiredInputs: [
    { id: 'report', label: 'What is going wrong?', placeholder: 'Describe the bug and what you expected instead', required: true },
    { id: 'repro', label: 'Steps to reproduce', help: 'How can the agents trigger it?', required: false },
    { id: 'context', label: 'Project / repo context', required: false },
  ],
  workflow: {
    id: 'bug-fixer',
    name: 'Bug Fixer',
    tag: 'Diagnose & fix',
    desc: 'Report → diagnose → fix → verify.',
    origin: { kind: 'builtin' },
    builtin: true,
    planning: { cut: 'by_role', clarifyThreshold: 0.5, maxClarifyQuestions: 2 },
    version: 1,
    updatedAt: '2026-06-19T00:00:00Z',
    stages: [
      { id: 'report', name: 'Report', icon: 'inbox', desc: 'Capture the bug and expected behavior.', kind: 'intake', seats: [], gate: { kind: 'none' }, fixed: true },
      { id: 'diagnose', name: 'Diagnose', icon: 'search', desc: 'Find the root cause.', kind: 'custom', seats: [{ ref: { kind: 'role', role: 'architect' }, brief: 'Locate and explain the root cause of the bug.' }], gate: { kind: 'user_approval' } },
      { id: 'fix', name: 'Fix', icon: 'wrench', desc: 'Apply the fix.', kind: 'work', seats: [{ ref: { kind: 'role', role: 'fixer' }, brief: 'Implement the smallest correct fix for the diagnosed cause.' }], gate: { kind: 'none' } },
      { id: 'verify', name: 'Verify', icon: 'eye', desc: 'Confirm the fix works and adds a test.', kind: 'review', seats: [{ ref: { kind: 'role', role: 'reviewer' }, brief: 'Verify the fix resolves the bug and is covered by a test.' }], gate: { kind: 'reviewer_signoff', reviewer: { kind: 'role', role: 'reviewer' }, blockOn: 'open_comments' } },
    ],
  },
  stageGuides: [
    { stageId: 'report', intent: 'We capture the bug and what you expected to happen.', expectedHandoffInputs: ['bug report'], expectedHandoffOutputs: ['reproduction summary'] },
    { stageId: 'diagnose', intent: 'An agent finds and explains the root cause for you to confirm.', expectedHandoffInputs: ['reproduction summary'], expectedHandoffOutputs: ['root-cause analysis'] },
    { stageId: 'fix', intent: 'A fixer applies the smallest correct change.', expectedHandoffInputs: ['root-cause analysis'], expectedHandoffOutputs: ['fix artifact'] },
    { stageId: 'verify', intent: 'A reviewer confirms the fix works and is tested.', expectedHandoffInputs: ['fix artifact'], expectedHandoffOutputs: ['verification result', 'regression test'] },
  ],
});

/** Unfamiliar repo → architecture map → starter tasks. */
export const CODEBASE_ONBOARDING_TEMPLATE: WorkflowTemplate = defineTemplate({
  templateId: 'codebase-onboarding',
  name: 'Codebase Onboarding',
  tag: 'Understand a repo',
  summary: 'Turn an unfamiliar repo into an architecture map and starter tasks.',
  bestFor: 'You inherited or joined a codebase and need to get oriented fast.',
  expectedOutput: 'An architecture map plus a list of safe starter tasks.',
  requiredInputs: [
    { id: 'repo', label: 'Which codebase?', placeholder: 'Repo, path, or description of the project', required: true },
    { id: 'focus', label: 'What do you want to understand or do first?', help: 'Optional area to bias the map toward.', required: false },
  ],
  workflow: {
    id: 'codebase-onboarding',
    name: 'Codebase Onboarding',
    tag: 'Understand a repo',
    desc: 'Scope → explore → map → starter tasks.',
    origin: { kind: 'builtin' },
    builtin: true,
    planning: { cut: 'by_role', clarifyThreshold: 0.4, maxClarifyQuestions: 2 },
    version: 1,
    updatedAt: '2026-06-19T00:00:00Z',
    stages: [
      { id: 'scope', name: 'Scope', icon: 'inbox', desc: 'Capture the repo and what to focus on.', kind: 'intake', seats: [], gate: { kind: 'none' }, fixed: true },
      { id: 'explore', name: 'Explore', icon: 'compass', desc: 'Survey the codebase structure.', kind: 'work', seats: [{ ref: { kind: 'role', role: 'architect' }, brief: 'Survey the repo structure, entry points, and key modules.' }], gate: { kind: 'none' } },
      { id: 'map', name: 'Map', icon: 'map', desc: 'Produce an architecture map.', kind: 'custom', seats: [{ ref: { kind: 'role', role: 'architect' }, brief: 'Produce a readable architecture map from the survey.' }], gate: { kind: 'user_approval' } },
      { id: 'starter-tasks', name: 'Starter tasks', icon: 'list', desc: 'Propose safe first tasks.', kind: 'plan', seats: [{ ref: { kind: 'role', role: 'planner' }, brief: 'Propose safe, well-scoped starter tasks from the map.' }], gate: { kind: 'user_approval' } },
    ],
  },
  stageGuides: [
    { stageId: 'scope', intent: 'We capture which codebase and what you care about.', expectedHandoffInputs: ['repo location', 'focus area'], expectedHandoffOutputs: ['onboarding scope'] },
    { stageId: 'explore', intent: 'An agent surveys the structure and entry points.', expectedHandoffInputs: ['onboarding scope'], expectedHandoffOutputs: ['structure survey'] },
    { stageId: 'map', intent: 'The survey becomes an architecture map you approve.', expectedHandoffInputs: ['structure survey'], expectedHandoffOutputs: ['architecture map'] },
    { stageId: 'starter-tasks', intent: 'You get a list of safe first tasks to pick from.', expectedHandoffInputs: ['architecture map'], expectedHandoffOutputs: ['starter task list'] },
  ],
});

export const BUILTIN_WORKFLOW_TEMPLATES: readonly WorkflowTemplate[] = [
  FEATURE_BUILDER_TEMPLATE,
  BUG_FIXER_TEMPLATE,
  CODEBASE_ONBOARDING_TEMPLATE,
];

export function getWorkflowTemplate(
  templateId: string,
): WorkflowTemplate | undefined {
  return BUILTIN_WORKFLOW_TEMPLATES.find((t) => t.templateId === templateId);
}

export function flagshipWorkflowTemplate(): WorkflowTemplate {
  return (
    BUILTIN_WORKFLOW_TEMPLATES.find((t) => t.flagship) ?? FEATURE_BUILDER_TEMPLATE
  );
}
