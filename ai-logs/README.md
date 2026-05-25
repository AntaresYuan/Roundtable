# ai-logs/

The living record of how we collaborate with AI on Roundtable.

## Layout

```
ai-logs/
├── decisions/        # ADRs (Architecture Decision Records)
├── incidents.md      # AI failure modes + lessons learned
├── handoffs.jsonl    # Runtime hand-off log (auto-appended by the platform)
└── prompt-history/   # Snapshots of important prompts at points of change
```

## Why this exists

Roundtable is a multi-agent platform. We must be honest about how AI shaped its development. `ai-logs/` is where we keep that record so:

- New teammates can trace *why* something is the way it is.
- We don't repeat the same AI-driven mistake twice.
- Reviewers (and graders) can verify our process, not just our output.

## Update etiquette

- ADRs are append-only. Supersede with a new ADR; do not edit accepted ones.
- `incidents.md` is also append-only with dated entries.
- `handoffs.jsonl` is machine-generated; do not edit by hand.
- `prompt-history/` snapshots are immutable once committed.
