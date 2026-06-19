import { describe, expect, it } from 'vitest';
import {
  BUILTIN_WORKFLOW_TEMPLATES,
  FEATURE_BUILDER_TEMPLATE,
  WorkflowSchema,
  WorkflowTemplateSchema,
  flagshipWorkflowTemplate,
  getWorkflowTemplate,
} from '../../src/contracts/index.js';

describe('WorkflowTemplateSchema', () => {
  it('ships exactly the three built-in templates', () => {
    expect(BUILTIN_WORKFLOW_TEMPLATES.map((t) => t.templateId)).toEqual([
      'feature-builder',
      'bug-fixer',
      'codebase-onboarding',
    ]);
  });

  it('parses every built-in template and its embedded workflow', () => {
    for (const template of BUILTIN_WORKFLOW_TEMPLATES) {
      expect(() => WorkflowTemplateSchema.parse(template)).not.toThrow();
      expect(() => WorkflowSchema.parse(template.workflow)).not.toThrow();
    }
  });

  it('gives every workflow stage a matching stage guide', () => {
    for (const template of BUILTIN_WORKFLOW_TEMPLATES) {
      const stageIds = template.workflow.stages.map((s) => s.id).sort();
      const guideIds = template.stageGuides.map((g) => g.stageId).sort();
      expect(guideIds).toEqual(stageIds);
    }
  });

  it('rejects a template whose stage guide references an unknown stage', () => {
    const broken = {
      ...FEATURE_BUILDER_TEMPLATE,
      stageGuides: [
        ...FEATURE_BUILDER_TEMPLATE.stageGuides,
        { stageId: 'does-not-exist', intent: 'orphan guide', expectedHandoffInputs: [], expectedHandoffOutputs: [] },
      ],
    };
    expect(() => WorkflowTemplateSchema.parse(broken)).toThrow();
  });

  it('rejects a template with a stage that has no guide', () => {
    const broken = {
      ...FEATURE_BUILDER_TEMPLATE,
      stageGuides: FEATURE_BUILDER_TEMPLATE.stageGuides.filter((g) => g.stageId !== 'review'),
    };
    expect(() => WorkflowTemplateSchema.parse(broken)).toThrow();
  });
});

describe('Feature Builder flagship template', () => {
  it('is the flagship', () => {
    expect(FEATURE_BUILDER_TEMPLATE.flagship).toBe(true);
    expect(flagshipWorkflowTemplate().templateId).toBe('feature-builder');
  });

  it('includes the clarify→deliver stage sequence from #148', () => {
    expect(FEATURE_BUILDER_TEMPLATE.workflow.stages.map((s) => s.id)).toEqual([
      'clarify',
      'plan',
      'split',
      'implement',
      'review',
      'repair',
      'deliver',
    ]);
  });

  it('gates plan approval, reviewer sign-off, and final delivery', () => {
    const gateByStage = Object.fromEntries(
      FEATURE_BUILDER_TEMPLATE.workflow.stages.map((s) => [s.id, s.gate.kind]),
    );
    expect(gateByStage['plan']).toBe('user_approval');
    expect(gateByStage['review']).toBe('reviewer_signoff');
    expect(gateByStage['deliver']).toBe('user_approval');
  });

  it('declares expected handoff inputs and outputs for each stage', () => {
    for (const guide of FEATURE_BUILDER_TEMPLATE.stageGuides) {
      expect(guide.expectedHandoffOutputs.length).toBeGreaterThan(0);
    }
  });

  it('collects a required goal input for the launch flow', () => {
    const goal = FEATURE_BUILDER_TEMPLATE.requiredInputs.find((i) => i.id === 'goal');
    expect(goal?.required).toBe(true);
  });
});

describe('getWorkflowTemplate', () => {
  it('finds a template by id and returns undefined for unknown ids', () => {
    expect(getWorkflowTemplate('bug-fixer')?.name).toBe('Bug Fixer');
    expect(getWorkflowTemplate('nope')).toBeUndefined();
  });
});
