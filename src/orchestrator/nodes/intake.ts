import type { IntakeResult, AgentRoleId } from '../../contracts/index.js';
import type { OrchestratorState } from '../state.js';

export interface IntakeClassifier {
  classify(message: string): Promise<IntakeResult>;
}

export function heuristicIntake(): IntakeClassifier {
  return {
    async classify(message: string): Promise<IntakeResult> {
      const lower = message.toLowerCase();
      const ambiguityScore = scoreAmbiguity(lower);
      const intentType = inferIntent(lower);
      const risk = inferRisk(lower);
      const suggestedRoles = inferRoles(intentType);
      const complexity = suggestedRoles.length > 1 ? 'multi_agent' : 'single_agent';

      return {
        intentType,
        clarity: ambiguityScore > 0.6 ? 'ambiguous' : 'clear',
        ambiguityScore,
        complexity,
        risk,
        suggestedRoles,
        userVisibleSummary: message.slice(0, 200),
      };
    },
  };
}

function scoreAmbiguity(msg: string): number {
  if (msg.length < 12) return 0.8;
  const vague = ['maybe', 'something', 'somehow', 'idk', 'whatever', 'thing'];
  const hits = vague.filter((w) => msg.includes(w)).length;
  return Math.min(1, hits * 0.25);
}

function inferIntent(msg: string): IntakeResult['intentType'] {
  if (/\b(build|create|add|implement|scaffold)\b/.test(msg)) return 'build';
  if (/\b(fix|bug|broken|error)\b/.test(msg)) return 'debug';
  if (/\b(review|audit|check)\b/.test(msg)) return 'review';
  if (/\b(stop|pause|cancel|abort)\b/.test(msg)) return 'control';
  if (/\b(show|list|inspect|read)\b/.test(msg)) return 'inspect';
  return 'modify';
}

function inferRisk(msg: string): IntakeResult['risk'] {
  if (
    /\b(deploy|production|prod|secret|password|payment|migrate|drop\s+table)\b/.test(
      msg,
    )
  ) {
    return 'high';
  }
  if (/\b(auth|database|schema|env|ci)\b/.test(msg)) return 'medium';
  return 'low';
}

function inferRoles(intent: IntakeResult['intentType']): AgentRoleId[] {
  switch (intent) {
    case 'build':
      return ['planner', 'implementer', 'reviewer'];
    case 'modify':
      return ['implementer', 'reviewer'];
    case 'debug':
      return ['fixer', 'reviewer'];
    case 'review':
      return ['reviewer'];
    case 'inspect':
      return ['planner'];
    case 'control':
      return [];
    default: {
      const _exhaustive: never = intent;
      return _exhaustive;
    }
  }
}

export async function runIntake(
  state: OrchestratorState,
  classifier: IntakeClassifier,
): Promise<OrchestratorState> {
  const intake = await classifier.classify(state.userMessage);
  const nextStage = intake.clarity === 'ambiguous' ? 'clarify' : 'plan';
  return { ...state, intake, stage: nextStage };
}
