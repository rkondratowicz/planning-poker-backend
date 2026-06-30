---
name: commit-conventions
description: Use when committing changes to this repo with `git commit`, preparing a commit message for the user, or amending a commit. Covers the imperative subject, optional Area: prefix, ~72-char body wrapping, and the no-emoji / no-Co-authored-by rules. Use ONLY for commit message construction in this repo.
---

# Commit conventions for this repo

This repo does NOT use Conventional Commits. There is no `feat:`/`fix:`/`chore:` prefix and no scope-in-parens. Conventions are inferred from the existing history (verify with `git log --format='%B' -10` if the style has shifted since this skill was written).

## Pre-commit gate

Before staging and committing, `pnpm typecheck && pnpm lint && pnpm test` must pass. AGENTS.md is explicit: "Do not commit if any of these fail." If `pnpm lint` complains about formatting, run `pnpm format` and re-stage. Do not commit to work around a failure.

## Subject line

- **Imperative mood**, first word capitalized: `Add`, `Move`, `Write`, `Bump`, `Extract`, `Fix`, `Refactor`, `Drop`, `Rename`.
- **No trailing period.**
- Keep it tight (most subjects in this repo are 45–70 chars; aim for ≤72).
- **Two acceptable shapes**, pick whichever fits:
  1. **Verb-led** — default, for most changes: `Add AGENTS.md onboarding doc for coding agents`, `Extract AGENTS.md sections into on-demand agent skills`.
  2. **Domain/Area-prefixed (colon)** — for large multi-file changes centered on one area: `Protocol layer: Zod schemas for ClientToServer, ServerToClient types, parseClientMessage`, `Scaffolding & leaf modules: package.json, tsconfig, biome, config, errors`. The area name is a short noun phrase, not a Conventional-Commits type.
- Do NOT mix in `feat:`/`fix:`/`chore:`/`docs:` prefixes — those are not part of this repo's style.

## Body

- **Separate subject and body with one blank line.**
- **Wrap at ~72 chars** (existing history is wrapped in the low-70s).
- Either form is acceptable:
  1. **Paragraph form** — one or a few sentences explaining *what changed and why*. `Add design decisions document`, `Add API contract for WebSocket planning poker backend`, and `Write README for human contributors` are models: they tell the story, not the diff.
  2. **Bulleted form** — `-` bullets, lowercase start, no trailing punctuation on each bullet. Use for multi-file/multi-change commits. Example: `ab280c6 Scaffolding & leaf modules:` and `c3ffb63 Bump dependencies to latest majors:` both use this.
- The body answers *why* and *what scope*; the diff already shows *what*. Don't restate file lists unless the change is broad (the bulleted form is for those cases).

## Don'ts

- **No `Co-authored-by:` footer.** None of the existing commits have one.
- **No "Generated with ..." / "🤖 Generated with ..." footers.** AGENTS.md forbids emoji in commit messages.
- **No emoji.** Applies to both subject and body (AGENTS.md: "No emoji in code or commit messages").
- **Do not squash or amend a commit that failed pre-commit checks or was pushed.** Follow the opencode system-prompt rule: only commit/amend/push when the user explicitly asks. If a commit fails hooks, fix the issue and create a *new* commit; do not amend.
- **Do not hand-edit `pnpm-workspace.yaml` lockfile entries or bypass hooks** to force a commit through.

## Worked examples (chosen from this repo's history)

Single-file, verb-led, paragraph body:

```
Add TASKS.md tracking the 5 implementation chunks

Single-file checklist at repo root. Each chunk is a coherent,
reviewable unit that builds on the last; 'Current' pointer at the
top tracks live progress. The git history of this file doubles as
the progress history.
```

Multi-file, area-prefixed, bulleted body:

```
Scaffolding & leaf modules: package.json, tsconfig, biome, config, errors

- package.json with pnpm scripts, deps (hono, ws, zod, pino), devDeps (tsx, vitest, biome, typescript)
- tsconfig.json strict mode per D4.1 (NodeNext, exactOptionalPropertyTypes, noUncheckedIndexedAccess, verbatimModuleSyntax)
- biome.json with recommended rules, 2-space, double quotes, semicolons
- src/config.ts env-bound config with bounds validation + ConfigError
- src/errors.ts single source of error message strings incl. invalidMessage(type) formatter
- test/config.test.ts, test/errors.test.ts (8 passing tests)
```

Doc-extraction, verb-led, paragraph body:

```
Extract AGENTS.md sections into on-demand agent skills

Move toolchain lessons, deployment lifecycle, and validation/error reference
out of the always-loaded AGENTS.md into three .agents/skills/ skills. Register
the .agents/skills path via a new opencode.json. AGENTS.md shrinks 194→143
lines; each extracted section leaves a one-line stub pointing at its skill.
```

## Verification before pushing

After committing, `git push` only when the user explicitly asks (per opencode's system-prompt rule). If a pre-push hook rejects, fix and create a new commit; do not force-push.