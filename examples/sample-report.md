# Silent-Write Audit — Sample Report

**Customer:** Acme SaaS (fictional, illustrative shape)
**Scan date:** 2026-05-07
**Codebase:** ~62k lines TypeScript, Supabase + Stripe + Postgres
**Schema source:** Supabase Management API
**Findings:** 18 total (11 critical, 7 high)
**Engagement tier:** Full delivery ($1,497) — patch PRs included for top 10
**Auditor:** CertNode (built the audit tool; runs it on customer codebases as a paid service)

> This is a real-shape sample report — the structure, severity tagging, and recommendation format match what a Full-tier customer receives. Customer name, specific findings, and file paths are illustrative.

---

## Executive summary

Acme SaaS's checkout, dispute-handling, and webhook layers each contain phantom-column references that PostgREST silently rejects at runtime. The most damaging are in the Stripe dispute-outcome write path (column `won` doesn't exist on `disputes`) and the Refund webhook (`amount_refunded_cents` doesn't exist on `payments`).

**Highest-revenue-impact finding:** dispute-outcome writes failing silently for 6+ weeks. Estimated revenue exposure: $XX,XXX in won-but-unbilled fees.

**Pre-commit hook recommendation:** install per `examples/pre-commit` to block recurrence. We've installed and tested the hook against your repo on a fork; awaiting merge.

---

## Findings by severity

### 🔥 CRITICAL (11)

#### C-1. Stripe dispute outcome never persists (revenue-blocking)

- **File:** `app/api/webhooks/stripe/dispute/route.ts:142`
- **Operation:** `disputes.update`
- **Phantom columns:** `won`, `evidence_score`
- **Why critical:** the entire dispute-outcome write path silently returns `{ data: null, error: PGRST204 }`; downstream fee-charging gated on `disputes.status === 'won'` never fires. Revenue exposure: 100% of won disputes since deploy.
- **Fix:** rename `won` → `outcome === 'won'` boolean check; move `evidence_score` to `metadata.evidence_score` (JSONB). 4 lines of change. Patch PR: [acme-saas/repo#PR-1].
- **Verification:** after fix, manually mark a test dispute as won; confirm `disputes.outcome` updates and downstream fee-charge fires. End-to-end test added in same PR.

#### C-2. Refund webhook drops payment-mark (compliance + accounting)

- **File:** `app/api/webhooks/stripe/refund/route.ts:78`
- **Operation:** `payments.update`
- **Phantom columns:** `amount_refunded_cents`, `refund_reason`
- **Why critical:** refund events fire but `payments.refund_status` is never updated, leading to refunded charges still flagged as `paid` in dashboards and reports. Auditing/compliance hazard.
- **Fix:** map `amount_refunded_cents` → existing `metadata.refund_amount_cents` (or add the column via migration; preferred). Patch PR: [acme-saas/repo#PR-2].

#### C-3. Subscription deauthorization handler — phantom flag

- **File:** `lib/billing/stripe/connected-deauth.ts:67`
- **Operation:** `connected_accounts.update`
- **Phantom columns:** `charges_enabled`
- **Why critical:** when a merchant deauthorizes the platform Stripe app, the handler tries to flip `charges_enabled` to false. The column doesn't exist; the entire UPDATE drops; the merchant remains in `active` state in your records, and webhooks continue to route to a deauthorized account.
- **Fix:** the canonical column is `is_active`; rename the payload key. Patch PR: [acme-saas/repo#PR-3].

#### C-4 through C-11

(8 more critical findings, abbreviated for sample report. In an actual deliverable, each gets the same File / Operation / Phantom / Why / Fix / PR-link / Verification structure.)

---

### ⚠️ HIGH (7)

(Findings that have the same bug class but on non-revenue-critical tables. Same structure, lower severity rating because business impact is bounded.)

#### H-1. GDPR redaction handler (compliance hazard, not revenue)

- **File:** `app/api/webhooks/shopify/gdpr/redact/route.ts:54`
- **Operation:** `dispute_evidence.delete (filter chain)`
- **Phantom columns:** `organization_id`
- **Why high (not critical):** redaction is silently skipped because the WHERE clause uses a phantom column. PostgREST returns `null` data, the handler treats that as "nothing to delete," and merchant data lingers. Compliance risk under GDPR Article 17.
- **Fix:** use `org_id` (the actual column). Patch PR: [acme-saas/repo#PR-12].

#### H-2 through H-7

(6 more high findings, abbreviated.)

---

## Pre-commit hook installation

We've installed `silent-write-audit` as a pre-commit hook on a fork of your repo, configured to:

- Run on staged TypeScript files only
- Block on critical findings (using the critical-table list we've ranked for your stack: `disputes`, `payments`, `connected_accounts`, `subscriptions`, `pending_fees`)
- Allow high findings (logged as warnings, don't block)

The hook is in `.githooks/pre-commit`. Configure your repo to use it:

```bash
git config core.hooksPath .githooks
```

Once configured, every commit runs the audit on staged files. New phantom-column references on critical tables block the commit until fixed. We've tested against the last 30 commits in your `main` branch — none would have been blocked, so the hook won't false-positive on your existing patterns.

---

## What's covered / what's not

**Covered by this audit:**
- All `.update()`, `.upsert()`, `.insert()`, `.select()`, and PostgREST filter calls under `app/`, `lib/`, and `src/api/`
- TypeScript and TSX files (parsed via the TypeScript compiler API)
- JSONB path expressions resolved correctly (`metadata->>field` matches base column)
- Schema as of 2026-05-07 (Supabase Management API snapshot at scan time)

**Not covered (by tool limitation today):**
- Drizzle and Prisma call sites (you have 4 Drizzle files in `lib/integrations/`; we've flagged them for manual review but don't have automated coverage in v0.1.x — the v0.3 ORM adapter will cover these)
- Spread operators in payloads (`{...obj}`) — silently skipped; manual review recommended in 12 specific call sites we surfaced separately
- Stored procedure calls (`.rpc(...)`) — v0.4 roadmap

---

## Recommendations beyond findings

1. **Schema-first mindset:** run `silent-write-audit` in CI on every PR (not just pre-commit). Catches drift between the schema file and what the tool sees against live Supabase. We've added a sample GitHub Actions workflow at `.github/workflows/silent-write-audit.yml` (commented; uncomment to enable).

2. **Move "experimental" columns to JSONB metadata:** the most common shape of these bugs is "we added a column, it didn't migrate, the code referenced it anyway." Putting in-flight columns under `metadata` (JSONB) avoids the bug class entirely until the column is canonical.

3. **Watch tier (recurring re-audit):** if your schema evolves frequently (we found 3 new tables in your repo's last 30 days), the Watch subscription ($4,997/year) re-runs this audit quarterly + alerts on any new phantom column the moment your CI catches it. See README for setup.

---

## Engagement summary

- Audit ran: 2026-05-07
- Total findings: 18 (11 critical, 7 high)
- Patch PRs shipped: 10 (top 10 by revenue impact)
- Pre-commit hook: installed on fork, ready for merge
- Walkthrough call: 30-min, scheduled within 7 days of report delivery
- Invoice: $1,497, due day-7 after PRs merged or rejected (or $0 if you find <3 critical — which is not the case here)

Questions or follow-up: `contact@certnode.io`.
