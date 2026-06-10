import { expect, test, type Page } from '@playwright/test';

interface StoredTurn {
  id: string;
  localChatId: string;
  message: string;
  status: 'done' | 'error';
  createdAt: string;
  provider?: string;
  model?: string;
  pmMessage?: string;
  needsApproval?: boolean;
  approvalStatus?: 'pending' | 'approved' | 'changes_requested';
  approvedAt?: string;
  artifacts?: unknown[];
  intake?: unknown;
  plan?: unknown;
  error?: string;
}

test('local live UI creates a task, restores history, and preserves approval', async ({ page }) => {
  const turns = new Map<string, StoredTurn>();
  await forceStableLocalChatId(page);
  await mockLocalOrchestrator(page, turns);

  await page.goto('/');
  await expect(page.getByPlaceholder(/Message the table/)).toBeVisible();

  await page.getByPlaceholder(/Message the table/).fill('Build a waitlist page with email capture');
  await page.getByRole('button', { name: 'Send message' }).click();

  await expect(page.getByText(/Drafting the plan/)).toBeVisible();
  await expect(page.getByText(/0\/1 done/)).toBeVisible();
  await expect(page.getByText('awaiting approval', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Implement waitlist page').first()).toBeVisible();
  await expect(page.getByText(/Files · 3/)).toBeVisible();
  await expect(page.getByText(/Demo waitlist copy/)).toHaveCount(0);

  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('approved', { exact: true }).first()).toBeVisible();

  await page.reload();
  await expect(page.getByText('Build a waitlist page with email capture').first()).toBeVisible();
  await expect(page.getByText('approved', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Files · 3/)).toBeVisible();
});

test('local live UI shows sanitized provider failures', async ({ page }) => {
  await forceStableLocalChatId(page);
  await page.route('**/api/orchestrator/history**', async (route) => {
    await route.fulfill({ json: { ok: true, turns: [] } });
  });
  await page.route('**/api/orchestrator/turn', async (route) => {
    await route.fulfill({
      status: 500,
      json: {
        ok: false,
        error: 'Incorrect API key provided: sk-[redacted]',
      },
    });
  });

  await page.goto('/');
  await page.getByPlaceholder(/Message the table/).fill('Trigger provider failure');
  await page.getByRole('button', { name: 'Send message' }).click();

  await expect(page.getByText('Incorrect API key provided: sk-[redacted]').first()).toBeVisible();
  await expect(page.getByText(/sk-test|sk-live|sk-proj/)).toHaveCount(0);
});

async function forceStableLocalChatId(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      configurable: true,
      value: () => 'e2e-local-chat',
    });
  });
}

async function mockLocalOrchestrator(page: Page, turns: Map<string, StoredTurn>) {
  await page.route('**/api/orchestrator/history**', async (route) => {
    const url = new URL(route.request().url());
    const chatId = url.searchParams.get('chatId');
    const scoped = [...turns.values()]
      .filter((turn) => !chatId || turn.localChatId === chatId)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    await route.fulfill({ json: { ok: true, turns: scoped } });
  });

  await page.route('**/api/orchestrator/turn', async (route) => {
    const body = route.request().postDataJSON() as { chatId: string; turnId: string; message: string };
    await page.waitForTimeout(250);
    const now = new Date().toISOString();
    const plan = {
      id: `${body.turnId}-plan`,
      createdAt: now,
      tasks: [
        {
          id: 'T1',
          title: 'Implement waitlist page',
          assignee: '@implementer',
          deps: [],
          user_visible: true,
          status: 'pending',
        },
      ],
    };
    const intake = {
      intentType: 'build',
      clarity: 'clear',
      ambiguityScore: 0,
      complexity: 'single_agent',
      risk: 'low',
      suggestedRoles: ['implementer'],
      userVisibleSummary: 'Build a waitlist page.',
    };
    const artifacts = [
      artifact(`intake-${body.turnId}`, 'markdown', `intake/${body.turnId}.md`),
      artifact(`plan-${body.turnId}`, 'spec', `plans/${body.turnId}.json`),
    ];
    const turn: StoredTurn = {
      id: body.turnId,
      localChatId: body.chatId,
      message: body.message,
      status: 'done',
      createdAt: now,
      provider: 'mock',
      model: 'mock-plan',
      pmMessage: 'I drafted a one-task plan.',
      needsApproval: true,
      approvalStatus: 'pending',
      intake,
      plan,
      artifacts,
    };
    turns.set(turn.id, turn);
    await route.fulfill({
      json: {
        ok: true,
        id: turn.id,
        provider: turn.provider,
        model: turn.model,
        pmMessage: turn.pmMessage,
        needsApproval: true,
        approvalStatus: 'pending',
        intake,
        plan,
        artifacts,
      },
    });
  });

  await page.route('**/api/orchestrator/approval', async (route) => {
    const body = route.request().postDataJSON() as { turnId: string };
    const turn = turns.get(body.turnId);
    if (!turn) {
      await route.fulfill({ status: 404, json: { ok: false, error: 'turn_not_found' } });
      return;
    }
    const approvedAt = new Date().toISOString();
    turns.set(turn.id, {
      ...turn,
      needsApproval: false,
      approvalStatus: 'approved',
      approvedAt,
    });
    await route.fulfill({
      json: {
        ok: true,
        id: turn.id,
        needsApproval: false,
        approvalStatus: 'approved',
        approvedAt,
      },
    });
  });
}

function artifact(id: string, kind: string, title: string) {
  return {
    id,
    kind,
    title,
    ownerAgentId: 'orchestrator',
    version: 1,
    uri: `turn://test/${id}`,
    preview: `${title}\n`,
    createdAt: new Date().toISOString(),
  };
}
