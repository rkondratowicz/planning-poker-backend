---
name: toolchain-and-dependencies
description: Use when adding or bumping a dependency, editing package.json / pnpm-workspace.yaml / tsconfig.json / biome.json / vitest.config.ts, or diagnosing an install/build failure. Covers pnpm v11 allowBuilds, TypeScript 6 @types/node quirk, Vitest 4 vite peer pin, Biome 2 migrate command, the pnpm build/test double-run trap, and the "never trust LLM memory for lib versions" workflow. Use ONLY for toolchain and dependency tasks.
---

# Toolchain & Dependencies

Footguns and lessons learned for this repo's toolchain. Append new entries here as they are discovered, not in AGENTS.md.

## Adding or changing dependencies

**Add/change dependencies via `pnpm`, never from LLM training data.** Do NOT pick a library version (or assume an API exists) from memory. Library majors ship breaking changes constantly (zod 3→4, biome 1→2, typescript 5→6, vitest 2→4, pino 9→10, @hono/node-server 1→2 all happened in this repo). Workflow for adding or bumping a dependency: (1) check the real latest with `pnpm view <pkg> version` (and `pnpm view <pkg> versions --json` if you need to pin a major); (2) install it with `pnpm add <pkg>` (or `pnpm add -D` for devDeps) so the lockfile, `package.json`, and pnpm supply-chain policies are updated correctly — hand-editing `package.json` then `pnpm install` is fine for bumps, but `pnpm add` is the only correct way to introduce a *new* dep; (3) read the package's own current docs (Context7 or the changelog) for breaking changes before touching code — your training data is stale; (4) run `pnpm typecheck && pnpm lint && pnpm test` and fix fallout before moving on. Pnpm v11 may auto-append a `minimumReleaseAgeExclude` entry to `pnpm-workspace.yaml` when you add a freshly-released package (e.g. vite@8.1.2) — that's expected, leave it.

## TypeScript 6 needs an explicit node types entry

TS 6.0 stopped auto-including `@types/node`. `tsc` fails with `Cannot find namespace 'NodeJS'` / `Cannot find name 'process'`. Fix: add `"types": ["node"]` to `tsconfig.json` `compilerOptions`. (`@types/node` stays on the 22 major on purpose to match node 22 LTS / Render's node 20 runtime; do not bump it to 26 just because it's published.)

## Vitest 4 needs `vite` >= 6 as a direct devDependency

Vitest 4's peer range is `vite ^6||^7||^8`. Without an explicit `vite` pin, pnpm resolves the transitive vite 5 and `pnpm test` blows up at startup with `ERR_PACKAGE_PATH_NOT_EXPORTED: ./module-runner`. Add `vite` (currently `^8.1.2`) to `devDependencies` via `pnpm add -D vite`.

## Biome 2 config migration

Bumping `@biomejs/biome` 1→2 is not a drop-in: the `biome.json` schema and several keys changed. Run `pnpm exec biome migrate --write` after the bump (it rewrites the `$schema` URL and transforms `files.ignore` → `files.includes` with `!`-negated patterns, top-level `organizeImports.enabled` → `assist.actions.source.organizeImports: "on"`, and `linter.rules.recommended: true` → `linter.rules.preset: "recommended"`). Then re-run `pnpm lint`. Don't hand-write a v2 config from memory — use the migrate command.

## `pnpm build` then `pnpm test` double-runs tests

`tsconfig.json` sets `rootDir: "."` and `include: ["src","test"]`, so `tsc` emits `dist/test/*.test.js`. Vitest's default glob (`**/*.{test,spec}.?(c|m)[jt]s?(x)`) then picks up those compiled copies alongside `test/*.test.ts`, so the count doubles (35 → 70) and `.gitignore`'d `dist/` silently affects test runs. When you run `pnpm build`, always `rm -rf dist` before `pnpm test`, or (preferred long-term) add a `vitest.config.ts` with `test: { exclude: ["dist/**", "node_modules/**"] }`. Until that config exists, treat the post-build test count as a false signal.

## pnpm v11 needs `allowBuilds` for native postinstalls

With pnpm v11, native-binary deps with `postinstall` scripts (`@biomejs/biome`, `esbuild`) are NOT run by default and `pnpm install` exits non-zero with `[ERR_PNPM_IGNORED_BUILDS]`, which also breaks any `pnpm <script>` (each script re-runs `pnpm install` via `verifyDepsBeforeRun`). `pnpm approve-builds` is interactive and unusable in a non-TTY agent shell. Fix: add `pnpm-workspace.yaml` next to `package.json` with an `allowBuilds:` map (e.g. `{"@biomejs/biome": true, "esbuild": true}`), then `rm -rf node_modules pnpm-lock.yaml && pnpm install` to re-resolve and actually run the builds. The `pnpm.onlyBuiltDependencies` field in `package.json` is no longer read by pnpm v11 (warned + ignored) — use `pnpm-workspace.yaml`. Without this, `pnpm build`/`pnpm start` on Render would also fail the deploy on a fresh machine.