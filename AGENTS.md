# AGENTS.md

Guidance for coding agents working in this repo. `README.md` covers the features, deployment and the full project layout; this file covers how to work on the code.

## Commands

```sh
npm ci              # install (Node 20+; CI uses 22)
npm run typecheck   # tsc over three configs: browser, service worker, and server + tests
npm test            # builds first, then runs every test/*.test.ts with node:test through tsx
npm run build       # esbuild: public/app.js, public/sw.js and dist/server.js
npm run dev         # rebuild on change and restart the server on :3000; accounts in data/dev-db.json
```

CI (`.github/workflows/ci.yml`) runs `npm run typecheck` and `npm test` on every push and pull request. Run both before you call a change done.

To run one file: `npm run build && node --import tsx --test test/compare.test.ts`. Some tests read the build output in `public/`, so build first.

The build output (`public/app.js`, `public/sw.js`, `dist/`) is gitignored. Never edit or commit it.

## How the code fits together

- **Tax engines** (`src/tax/`) are pure functions with no DOM. `tax.ts` handles federal income tax, FICA and self-employment tax for the household, and calls `state-tax.ts` for state and local tax. Each state is a data entry in one of the four regional files in `src/tax/states/`, registered by `states/index.ts`.
- **App core** (`src/app/core.ts`) owns the pay inputs, the budget, tabs and persistence (`localStorage` key `incomebudget:v1`). Every other feature is a module registered in `src/app/main.ts` with `App.register()`. The module API is described in the "Module API" comment in `core.ts` and typed in `src/app/types.ts`.
- **Server** (`server/`) is plain `node:http` with no framework: static files from an allowlist, scrypt passwords with hashed session tokens, and a sync API that stores one JSON document per account in Postgres, a JSON file (`npm run dev`) or memory.
- The only runtime dependencies are `esbuild` and `pg`. Don't add one without a strong reason.

## Conventions

### TypeScript

- Strict mode with `verbatimModuleSyntax`, so type-only imports use `import type`.
- Each feature module keeps its types in a type-only sibling file (`compare.ts` and `compare.types.ts`).
- Every file opens with a block comment saying what it is and how it connects to the rest. Update it when you change what the file does.
- Comments explain why, or cite the rule behind a number ("IRC §225", "Form 446"). Write them as plain sentences, matching the code around them.

### Feature modules

Follow an existing module; `src/app/compare.ts` is the smallest complete one.

- Export the pure logic (calculations, `sanitize`, ...) so tests can import it, and keep DOM work in `init` and `render`. Nothing may touch the page at import time: tests import these modules in Node, and `core.ts` waits for `start()`.
- State a module owns lives under its `stateKey` and goes through its `sanitize()` whenever it's loaded from storage, an import or the server. Inputs that shouldn't sync between devices (like the compare card's) use their own `localStorage` key, `incomebudget:<module>`.
- A module renders into its `#<name>Root` element in `public/index.html` and is styled by `public/css/<name>.css`.
- The app starts blank. Never add sample data.

### Adding a static file (stylesheet, icon, ...)

These have to agree, and `test/pwa.test.ts` checks the first two:

1. Link it from `public/index.html` (scripts, stylesheets and icons).
2. List it in `PRECACHE` in `src/sw.ts`.
3. Make sure `server/static.ts` serves it. Files at the root are an explicit allowlist (`ROOT_FILES`); files in `css/` and `icons/` are served by extension (`TYPES`).

### Browser constraints

- `public/app.js` is one classic (IIFE) script, so `index.html` also works opened straight from disk. Don't switch to module scripts or split the bundle.
- The Content Security Policy (`server/http.ts`) only allows scripts from the app's own files: no inline `<script>` blocks and no `on*=` attributes.
- iPhone Safari layout rules, enforced by `test/layout.test.ts`: no `position: sticky` anywhere, and the tab bar stays in normal flow, never fixed to the bottom.
- Keep `const VERSION = "v1";` in `src/sw.ts` one declaration with a plain string literal. The server rewrites that line with a hash of the app's files, so each deploy updates installed copies.

### Tax figures

Every number is for tax year 2026 and must be traceable to a source.

- Federal figures live in `src/tax/tax.ts` and are sourced in `docs/tax-sources.md`. State figures live in `src/tax/states/*.ts` and are sourced in the matching `docs/state-tax-sources/*.md`.
- When you add or change a figure, update its sources doc in the same commit: the link, and how it was confirmed, using the flags that doc already uses.
- Never enter a figure from memory as if it were confirmed. If any of a state's figures haven't been checked against 2026 sources, set `unverified: true` on its entry and list what's still missing in the docs.
- `STATE_SCHEMA` in `src/tax/state-tax.ts` documents a state entry. Use its fields where they fit, and `compute()` only for rules they can't express. Each state test file runs `validate()` on its entries.
- In tests, write expected values as arithmetic from the published figures (`5500 * 0.015 + (16500 - 5500) * 0.032 + ...`) so a reviewer can check them against the source, not as unexplained totals.
- The engine assumes the standard deduction, and the app gives estimates, not tax advice. Keep that framing in UI text.

### Tests

- `node:test` with `node:assert/strict`, written in TypeScript, one file per area in `test/`.
- Name a test as a sentence about the behavior it checks, e.g. `"compare: a pay cut mirrors a raise"`.
- Add or update tests with every behavior change; new pure logic gets its own tests.
- Never skip or delete a failing test to get to green.

### Writing

- UI text and docs: short, plain sentences that speak to the user ("your take-home"), like the README.
- Commit messages: an imperative subject line, and a body that says what changed and why, in prose or a short list.
