# ADR-010: UI design language — Hydrangea palette, Notionists avatars, Notion-aligned atoms

## Status

Accepted (2026-06-04)

## Context

The product UI read as "cheap / generic-AI" despite a competent token system (3 aesthetics ×
light/dark × density, OKLCH color-mix). A long design exploration concluded the cheapness was
**craft/illustration + execution choices, not the color system** — and that hand-authored
character SVGs looked wrong. The UI/demo owner wants a product-grade look, not just a demo.

## Decision

- **Palette = 紫陽花 / Hydrangea** (blue → lavender, "dreamy summer") on the default `neutral`
  aesthetic in `src/ui/styles/tokens.css`: light `--bg #eeeaf6` · `--surface #fff` ·
  `--text #36304f` · `--accent #7e72c9` (+ a deep-plum dark theme). The `document` and
  `technical` aesthetics are unchanged.
- **Agent/teammate figures = DiceBear "Notionists"** (CC0), rendered **only** through the
  `Avatar` component (`src/ui/components/primitives.jsx`) and the roundtable `Figure`
  (`roundtable.jsx`). Seed = agent `id`; the agent's `color` stays as the ring (identity).
  **Never render a letter / emoji / colored-sphere as an agent avatar inline.**
- **Atoms aligned to Notion**: `Icon` stroke 1.6; tight radii (`--r-sm` 6 / `--r-card` 10);
  buttons at `fontWeight 500` (calm, no heavy shadow); role tags = square soft tags (radius 4,
  via the `RoleTag` primitive). Status/severity use `--bad/--warn/--run` tokens, not ad-hoc hex.
- **Logo** (`LogoMark`, chat.jsx) = a solid 3D table mark (no dots/spark), fill `currentColor`.
  Used **only** as the brand mark (rail header, welcome card) — not as a section/workbench icon.
- **The roundtable scene was kept.** This was a re-skin (palette + avatars + atoms), **not** a
  redesign into a Notion-style app.

## Why

- Ready-made CC0 character art (Notionists) gives the scene soul without commissioning or
  image-gen; the alternative paths (commission ≈ $1.5–6k; AI-gen + cleanup) were heavier.
- Notion's calm warm-neutral editorial language + a single dreamy-summer accent reads premium
  and distinct from the sea of cold-IDE / default-blue AI tools.

## Consequences

- **DiceBear is a runtime external dependency**: avatars are fetched from
  `https://api.dicebear.com/9.x/notionists/svg?seed=<agentId>` at render time. **Self-host the
  SVGs before production** (latency, availability, offline) — no env var.
- Re-skinning the `neutral` aesthetic changed its identity from the old warm-beige.
- The earlier `ui-handoff-batch1.md` "avatar?: emoji or url" notion is superseded by this.
