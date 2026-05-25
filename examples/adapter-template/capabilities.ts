import type { AgentCapabilities } from '../../contracts/adapter';

// TODO(template): set the capability flags honestly. False is the safer
// default; the Orchestrator will fall back gracefully when a capability
// is missing.
export const CAPABILITIES: AgentCapabilities = {
  streaming: true,
  toolUse: false,
  fileEdits: false,
  persistentSessions: false,
  mcp: false,
  multimodal: false,
};
