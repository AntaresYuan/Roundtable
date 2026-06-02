import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SelectorDecisionEntry } from '../contracts/index.js';

/**
 * Sink for selector telemetry rows. Default deployment writes to
 * `ai-logs/selector-decisions.jsonl` (mirrors the `handoffs.jsonl` pattern);
 * tests use the in-memory implementation.
 */
export interface SelectorTelemetry {
  record(entry: SelectorDecisionEntry): Promise<void>;
  entries(): readonly SelectorDecisionEntry[];
}

export function inMemorySelectorTelemetry(): SelectorTelemetry {
  const buf: SelectorDecisionEntry[] = [];
  return {
    async record(entry) {
      buf.push(entry);
    },
    entries() {
      return buf;
    },
  };
}

export function fileSelectorTelemetry(path: string): SelectorTelemetry {
  const buf: SelectorDecisionEntry[] = [];
  return {
    async record(entry) {
      buf.push(entry);
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, `${JSON.stringify(entry)}\n`, 'utf8');
    },
    entries() {
      return buf;
    },
  };
}
