# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

**Lenakids OpsPilot ERP** — an internal operations / supply-chain / finance console for an
e-commerce business, plus a separate supplier-facing portal. The UI is entirely in
**Simplified Chinese** and all times are displayed in **Beijing time (Asia/Shanghai)**.

It is a Lovable project: a Vite + React + TypeScript SPA on the frontend, with Supabase
(Postgres + Auth + Edge Functions) as the entire backend. The dominant backend concern is
syncing data from **聚水潭 (JuShuiTan / "JST")**, a third-party Chinese ERP, via its OpenWeb API.

## Commands

```sh
npm i              # install (bun.lock and package-lock.json both present; npm is canonical)
npm run dev        # Vite dev server on http://localhost:8080
npm run build      # production build (Vite only — NO type-checking step; see note below)
npm run build:dev  # build in development mode
npm run lint       # ESLint over the repo
npm run preview    # serve the built dist/

npm test                       # run all Vitest unit tests once
npm run test:watch             # Vitest watch mode
npx vitest run src/lib/foo.test.ts        # run a single test file
npx vitest run -t "name of test"          # run tests matching a name
```

- **There is no `typecheck` script and `vite build` does not type-check.** Run
  `npx tsc --noEmit` (or rely on the editor) to catch type errors before committing.
- ESLint has `@typescript-eslint/no-unused-vars` turned **off** — unused vars won't fail lint.
- **Unit tests** (Vitest + jsdom + Testing Library) live next to source as `*.test.ts(x)` under
  `src/`. **E2E tests** use Playwright via the `lovable-agent-playwright-config` package
  (`playwright.config.ts` / `playwright-fixture.ts` just re-export it).

### Supabase / Edge Functions

Edge functions are Deno, under `supabase/functions/<name>/index.ts`. Project ref is in
`supabase/config.toml`. Deploy with the Supabase CLI, e.g.
`supabase functions deploy jst-sync-sales-orders`. Schema lives in `supabase/migrations/`
(70+ timestamped SQL files); add a new migration file rather than editing old ones.

## Architecture

### Frontend

- **Routing** is centralized in `src/App.tsx`. Every route is wrapped by `ProtectedRoute`
  with an `audience` of either `"internal"` (company staff → `OpsLayout`) or `"supplier"`
  (vendor accounts → `SupplierLayout`). `ProtectedRoute` redirects across audiences based on
  `profile.user_type`, so an internal route and a supplier route are mutually exclusive.
- **Path alias:** `@` → `src/` (configured in `vite.config.ts`, `vitest.config.ts`, tsconfig).
- **UI:** shadcn/ui components in `src/components/ui/` (configured via `components.json`),
  Tailwind, lucide icons. Use `cn()` from `@/lib/utils` for class merging.
- **Data fetching:** `@tanstack/react-query` (single `QueryClient` in `App.tsx`) calling the
  Supabase JS client directly. Toasts via both `sonner` and the shadcn `toaster`.
- **Navigation model:** the internal app is organized into "systems" (运维/商品/客服/财税/
  仓库/采购/供应商/数据中心/系统设置) defined in `src/components/ops/OpsSidebar.tsx`, with an
  open-tabs bar (`TabsBar`) in `OpsLayout`. Many sidebar entries route to `OpsPlaceholder`
  (a generic stub page) — those features are not built yet.

### Supabase integration

- `src/integrations/supabase/client.ts` — the singleton browser client. **Auto-generated;
  do not edit.** Reads `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`.
- `src/integrations/supabase/types.ts` — **auto-generated** DB types (`Database`). Regenerate
  via the Supabase CLI after migrations; don't hand-edit.
- `src/integrations/lovable/index.ts` — **auto-generated** Lovable OAuth wrapper; don't edit.

### Auth & roles

`useAuth` (`src/hooks/useAuth.ts`) wraps Supabase auth and loads `profiles` + `user_roles`.
Key conventions:
- Login accepts a username/identifier, not just email. Non-email identifiers are resolved to
  an email via the `get_email_by_identifier` RPC; **supplier** accounts fall back to a synthetic
  `<username>@supplier.local` address.
- `user_type` is `'internal' | 'supplier'`; app roles (`AppRole`) are `'employee' | 'manager'
  | 'finance'`. Edge functions check ops roles server-side via the `has_ops_role` RPC.

### JST (聚水潭) sync — the core backend system

This is the most complex and important part of the codebase. Shared helpers live in
`supabase/functions/_shared/`:

- **`jst-client.ts`** — the OpenWeb API client: MD5 request signing, access-token cache +
  auto-refresh (stored in `jst_tokens`), all requests routed through an **HTTP proxy**
  (`JST_PROXY_*` env, because JST enforces an IP whitelist), plus list/pagination parsing
  helpers (`pickList`, `pickItemsArray`, `computeHasNext`) that tolerate JST's inconsistent
  response shapes. `resolveCaller()` authorizes requests (admin JWT, cron secret, or internal tick).
- **`jst-sync-job.ts`** — a generic **resumable, windowed, self-driving job engine** built on
  the `jst_sync_jobs` / `jst_sync_logs` / `jst_sync_log_details` tables. It splits a time range
  into windows, paginates each within a time/page budget per "tick," persists a cursor, and
  **auto-continues by self-invoking the edge function** (`EdgeRuntime.waitUntil`). It handles
  transient errors with retry/backoff and adaptive window-splitting, cooperative cancellation,
  stale-job detection, and atomic per-job locks (`jst_try_lock_job` / `jst_release_job_lock` RPCs).
  New sync functions should reuse `handleJobActions(...)` and implement only a `processPage` fn.
- **`orderClassify.ts`** — classifies an order into an internal lifecycle type
  (未付款取消 / 付款后未发货退款 / 发货后退货 / 已付款待发货 / 已发货). **This file is duplicated
  at `src/lib/orderClassify.ts` for the frontend — the two MUST be kept in sync** (the header
  comments say so).
- **`shop-filter.ts`** — skips disabled / sync-off shops during sync.

Per-domain sync functions (`jst-sync-{sales-orders,products,purchase-orders,outbound-orders,
refund-orders,dispatch,...}`) follow a common shape: a `start_*` / `tick_*` / `cancel_*` job
protocol (the modern path) plus a legacy one-shot background sync (for cron). Example to read
first: `jst-sync-sales-orders/index.ts`, which also derives `sales_order_light_items`,
`order_lookup_index`, sales summaries, and `shipping_risk_orders` from each synced order.

Privacy: sync code **strips PII** (receiver name/phone/address, buyer contact) before writing
raw payloads — see the `PRIVACY_KEYS` set and `sanitize()` in the sales sync function; only
province/city/district are retained.

Other edge functions: `ask-ai` (dashboard AI assistant), `parse-bank-receipt` (receipt OCR for
cashflow), `admin-supplier-accounts` / `bootstrap-accounts` (account provisioning),
`supplier-purchase-order(s)(-detail)` (supplier-portal data), `ops-product-master-derive`.

### Business-logic libraries (`src/lib/`)

- `finance.ts` — cashflow/finance domain types + `fmtMoney` (CNY). Backs the 财税 (finance) module.
- `deliveryTolerance.ts` — pure display-layer rules for the 货期交付看板 (delivery dashboard):
  completion tolerance (≥98%), over-delivery, and "tail-difference" filtering. **Display only —
  never mutates DB or PO status.**
- `purchaseMatch.ts`, `statusLabel.ts`, `datetime.ts`, `financeImport.ts` — purchase matching,
  status labels, date helpers, and finance import parsing respectively.

## Conventions & gotchas

- **Legacy / unrouted code:** the repo still contains the original Lovable "expense
  reimbursement" template that is **not wired into `App.tsx`** and is effectively dead:
  `src/pages/expenses/`, `src/pages/manager/`, `src/pages/finance/`, `src/pages/Dashboard.tsx`,
  `src/pages/Index.tsx`, `src/pages/AskAI.tsx`, `src/components/layout/AppLayout.tsx` +
  `AppSidebar.tsx`, `src/components/dashboard/`, `src/components/expenses/`, and the `Expense*`
  types in `src/lib/types.ts`. Don't assume these are live; the active app uses `OpsLayout` /
  `SupplierLayout` and the `ops/` pages & components. Confirm against `App.tsx` before touching.
- **Generated files — do not edit:** `src/integrations/supabase/client.ts`,
  `src/integrations/supabase/types.ts`, `src/integrations/lovable/index.ts`.
- **Lovable workflow:** this repo is connected to Lovable; edits made in Lovable auto-commit
  here, and pushes here reflect back in Lovable. Keep changes compatible with that round-trip.
- **Environment:** `.env` (git-tracked) holds only the public `VITE_SUPABASE_*` anon/publishable
  keys + URL. `.env.local` (gitignored) holds server secrets / DB credentials for local tooling.
  Edge functions read their own secrets from the Supabase environment (`JST_APP_KEY/SECRET`,
  `JST_ACCESS_TOKEN/REFRESH_TOKEN`, `JST_PROXY_*`, `SUPABASE_SERVICE_ROLE_KEY`,
  `JST_SYNC_CRON_SECRET`, etc.).
- **Localization:** all user-facing strings are Chinese; render/compute times in Asia/Shanghai
  (`OpsLayout` clock, `fmtBJ`, `parseJstBeijingDateTime`).
