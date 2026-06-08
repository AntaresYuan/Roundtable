import { providerDiagnostics } from '@/orchestrator/llm/provider';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({
    ok: true,
    diagnostics: providerDiagnostics(),
  });
}
