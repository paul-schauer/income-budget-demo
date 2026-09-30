# Take-home & budget

Personal income and budget project to demo quick application for agentic engineering.

Estimate your take-home pay in any US state (for you, your spouse and any extra income), plan a budget around it, and track what you actually spend.
Written in TypeScript. The browser app builds to static files; the included Node server (for example on Railway) adds optional accounts that sync your data between devices.

## Features

- **Paycheck** (2026 tax year): federal income tax, Social Security, Medicare (with the additional 0.9%), and state income tax for all 50 states and DC.
  - State payroll deductions such as disability insurance and paid family leave (California, New York, New Jersey, Washington and others).
  - Local income taxes: Michigan's 24 cities, New York City and Yonkers, Maryland counties, and major cities elsewhere, plus an "other local rate" field for anywhere else.
  - **Spouse's pay** on a joint return: taxed together, with each spouse's own Social Security and 401(k) limit, and each person's paycheck shown.
  - **Other income**: self-employment (with self-employment tax and the 20% QBI deduction), a second W-2 job, other taxable income, and non-taxable income. It shows how much to set aside when no tax is withheld.
  - Salary or hourly pay, four filing statuses, and weekly, biweekly, semimonthly or monthly paychecks.
  - Traditional or Roth 401(k), capped at the limit, and pre-tax benefits (health, HSA, FSA).
  - Child and other-dependent credits, and extra W-4 withholding.
  - A "where each paycheck goes" bar and the take-home value of a $1,000 raise.
  - A **bonus & overtime estimator**: withholding on a bonus check vs. the actual tax on it at year end, and extra take-home from overtime, including the 2026 overtime deduction.
- **Budget**: items repeat weekly through annually and are converted to any period.
  - Categories, bill due days, % of take-home, sorting, inline edit, and delete with undo.
- **Calendar**: which bills come out of which paycheck.
  - Flags short and tight paychecks, suggests a due date to move to even them out, and has a month grid of paydays and due dates.
- **Goals**: savings goals set either by a target date or by an amount per paycheck, using your real pay schedule.
  - Goals count toward the budget, so "left over" stays honest.
- **Spending**: log transactions or import a CSV from your bank (Chase, Bank of America, Capital One and credit union formats).
  - Transactions are assigned to budget items automatically, and it learns merchant rules as you correct it.
  - Compares planned vs. actual by month, with pace tracking.
- **Accounts & sync** (optional, needs the server): sign in to keep your phone and computer in sync.
  - Everything still saves in the browser without an account.
- **Install as an app**: add it to your phone's home screen. It works offline.
- JSON export/import and dark mode.
- **Starts blank**: no sample data. A short setup guide on the Paycheck and Calendar tabs and one-tap "quick add" bills on the Budget tab get you going.

## Run locally

```sh
npm install
npm run build      # bundle the app (public/app.js, public/sw.js) and the server (dist/server.js)
npm start          # http://localhost:3000, accounts kept in memory
npm run dev        # rebuild on change and restart the server; accounts persist to data/dev-db.json
npm test           # build, then run all unit and server tests
npm run typecheck  # strict TypeScript check (browser, service worker, server and tests)
```

After a build you can also open `public/index.html` straight from disk. Everything except sign-in and offline install works that way.

## Deploy to Railway

1. In Railway, create a project from this GitHub repo.
2. Add a **PostgreSQL** service to the project.
3. On the app service, open **Variables** and add:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - optional: `ALLOW_SIGNUP=false` once you've created the accounts you want. Existing accounts can still sign in.
4. Under **Settings → Networking**, generate a domain.

`railway.json` already sets the build command (`npm run build`), the start command (`node dist/server.js`) and the `/api/health` health check.
The server creates its tables on first start.
`TRUST_PROXY` is turned on automatically on Railway so rate limits see real visitor IPs.
Each deploy stamps the service worker with a hash of the app's files, so installed copies pick up the new version on their next visit.

See `.env.example` for every setting.

### Security notes

- Passwords are hashed with scrypt. Sessions are random tokens in HttpOnly, SameSite cookies, and only a hash of each token is stored.
- Sign-in and sign-up are rate limited. Requests that change data must be same-origin JSON.
- The server only serves the built app from `public/`: `index.html`, `styles.css`, `app.js`, `sw.js`, the manifest, `css/` and `icons/`. Source, server code and tests are never served.
- A strict Content Security Policy blocks inline scripts.
- Your budget data is stored as one JSON document per account.

## TypeScript and the build

Everything is TypeScript in strict mode. [esbuild](https://esbuild.github.io/) bundles `src/app/main.ts` into `public/app.js` (one classic script, so the page also works from disk), `src/sw.ts` into `public/sw.js`, and `server/index.ts` into `dist/server.js`. Tests run straight from the TypeScript through [tsx](https://tsx.is/). `npm run typecheck` runs `tsc` over three configs: browser code, the service worker, and the server plus tests. CI runs the type check and the tests on every push and pull request.

## Tax assumptions

Federal rates live in `src/tax/tax.ts`, sourced in `docs/tax-sources.md`. State rates are data entries in `src/tax/states/`, computed by the engine in `src/tax/state-tax.ts` and sourced in `docs/state-tax-sources/`. Each source file flags figures confirmed only through secondary sources.
The calculation assumes the standard deduction. It's an estimate, not tax advice.

## Project layout

| Path | What |
|---|---|
| `public/` | Static files served as-is: `index.html`, `styles.css`, `css/`, `icons/`, the manifest, and the build output (`app.js`, `sw.js`) |
| `src/tax/tax.ts` | Household tax engine: federal, FICA, self-employment |
| `src/tax/state-tax.ts`, `src/tax/states/` | State and local tax engine, and one data entry per state |
| `src/lib/schedule.ts` | Payday schedule helpers |
| `src/app/core.ts`, `src/app/types.ts` | App core, tabs, and the module API (`App.register`) |
| `src/app/main.ts` | Browser entry point: registers the feature modules and starts the app |
| `src/app/bonus.ts`, `calendar.ts`, `goals.ts`, `spending.ts` | Feature modules, each styled by `public/css/*.css` |
| `src/app/sync.ts` | Sign-in dialog and cloud sync client |
| `src/app/pwa.ts`, `src/sw.ts` | Installable app and offline support |
| `server/` | Node server: static files, auth, sync API, Postgres/in-memory storage |
| `scripts/build.mjs` | esbuild build |
| `test/` | `node:test` suites, in TypeScript |
