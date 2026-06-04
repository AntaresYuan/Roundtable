import type { z } from 'zod';

export function parseJsonFromText<T extends z.ZodTypeAny>(
  text: string,
  schema: T,
): z.output<T> {
  return schema.parse(JSON.parse(extractJsonObject(text)));
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  if (fenceMatch?.[1]) return extractJsonObject(fenceMatch[1]);

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('model did not return a JSON object');
  }
  return trimmed.slice(start, end + 1);
}
