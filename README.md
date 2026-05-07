# silent-write-audit

<video src="https://raw.githubusercontent.com/srbryant86/silent-write-audit/main/media/silent-write-audit-walkthrough.mp4" controls width="100%" style="max-width:720px"></video>

> ~90-second walkthrough (AI-narrated): bug class, what we found in our own codebase, what the audit delivers, pricing.

A static-analysis audit for the silent-fail bug class in Supabase / PostgREST writes — where a `.update({...})` call with a column that doesn't exist on the target table is silently rejected, the entire statement is dropped, and your code logs one line nobody reads.

```ts
await supabase.from('disputes').update({
  status: 'won',
  won: true,                   // ← phantom column. PostgREST drops the entire UPDATE.
  evidence_score: 87,          // ← also phantom. You don't find out for weeks.
}).eq('id', disputeId)
```

PostgREST returns `PGRST204`. Your code gets `{ data: null, error: { ... } }`, fires one `console.error`, and continues as if the write succeeded. Three weeks later you discover the entire feature was a no-op. This is the bug.

## The bug class

PostgREST silently rejects the entire query if **any** column referenced in the payload, the `.select()` projection, or a filter chain (`.eq()`, `.neq()`, `.gt()`, etc.) doesn't exist on the target table. There is no partial-success path. Your code looks fine, the wire response is a 4xx, your logs have one line, and the rest of your application proceeds as if the write succeeded.

We pointed this audit at our own production codebase (CertNode — ~80k lines of TypeScript, Stripe + Supabase + Postgres) and it found **~50 silent-write bugs in one night**. The most damaging ones:

- Stripe dispute outcomes that hadn't been persisting for weeks (`disputes.won` and `disputes.evidence_score` were both phantom columns)
- `connected_accounts.charges_enabled` never flipping after a Stripe deauthorization (phantom column on the deauth handler)
- A GDPR redaction handler that was a silent no-op (phantom `customer_email` and `dispute_evidence.organization_id`)
- Bitcoin Layer 3 timestamp verification 100% broken for 5+ weeks while the hourly cron returned `success: true` every run — three cascading silent bugs each masked by the next; only caught by an end-to-end verification check, never by unit tests or production logs
- WooCommerce billing rows that never recorded fees (5 phantom columns in one row)

The audit catches all of these with static analysis. The pre-commit hook variant blocks new ones from shipping.

## Install

```bash
npm install -D @certnode/silent-write-audit
# or run ad-hoc
npx @certnode/silent-write-audit --help
```

## Quick start

```bash
# 1. Set Supabase Management API credentials
export SUPABASE_ACCESS_TOKEN=sbp_xxxxx     # https://supabase.com/dashboard/account/tokens
export SUPABASE_PROJECT_REF=xxxxxxxxxxxxxxx # in your project URL or Settings → General

# 2. Run the audit (scans ./app and ./lib by default)
npx silent-write-audit

# 3. (Optional) Run only on staged files for a pre-commit hook
npx silent-write-audit --staged --ci-critical-only
```

The first run hits the Supabase Management API for your live schema and caches it for 24 hours in `.schema-cache.json`. Subsequent runs are fast (a few hundred milliseconds for a mid-sized codebase).

## Sample output

Run against a real codebase, the human-readable output looks like this (these are paraphrased real findings from our own production scan):

```
$ npx silent-write-audit

[silent-write-audit] Schema loaded: 47 tables
[silent-write-audit] Scanning 287 files...

[silent-write-audit] ⚠ Found 12 issue(s) (8 critical, 4 high)

🔥 CRITICAL  app/api/webhooks/stripe/dispute/route.ts:142
         table: disputes.update
         missing: won, evidence_score
         (PostgREST PGRST204 rejects the entire update — silent fail)

🔥 CRITICAL  app/api/webhooks/stripe/connected/route.ts:67
         table: connected_accounts.update
         missing: charges_enabled
         (PostgREST PGRST204 rejects the entire update — silent fail)

🔥 CRITICAL  lib/billing/woocommerce-fees.ts:198
         table: pending_fees.upsert
         missing: platform, external_dispute_id, fee_amount, fee_rate, amount_won
         (PostgREST PGRST204 rejects the entire upsert — silent fail)

🔥 CRITICAL  app/api/webhooks/shopify/gdpr/redact/route.ts:54
         table: dispute_evidence.delete (filter chain)
         missing: organization_id
         (PostgREST 400s the entire query — returns null data, silent fail)

⚠️  HIGH     lib/disputes/evidence-vault.ts:203
         table: dispute_evidence.select
         missing: organization_id
         (PostgREST 400s the entire query — returns null data, silent fail)

... (7 more findings omitted)

Tip: add `// silent-write-audit-ignore` on the line above an op to allowlist it.
```

Each `🔥 CRITICAL` is a write or read against a revenue-tagged table that PostgREST has been silently rejecting. Each `⚠️ HIGH` is a non-revenue table with the same bug class. The fix is one keystroke per finding (rename, remove, or move-to-metadata); the audit cost is the months of revenue you lost not knowing.

> _Output above is shape-illustrative: our own production scan found ~50 findings; we've shown 5 of the most damaging and abbreviated the rest. By default (no `.silent-write-audit.json`), all findings show as `⚠️ HIGH` severity — `🔥 CRITICAL` requires the optional `criticalTables` config below._

JSON output (`--json`) emits the same findings in a structured form for CI:

```json
{
  "findings": [
    {
      "file": "app/api/webhooks/stripe/dispute/route.ts",
      "line": 142,
      "table": "disputes",
      "op": "update",
      "kind": "update_payload_phantom",
      "missing": ["won", "evidence_score"],
      "all_keys": ["status", "won", "evidence_score", "updated_at"],
      "severity": "critical"
    }
  ],
  "summary": { "total": 12, "critical": 8, "high": 4 }
}
```

## Config

Optional `.silent-write-audit.json` in your project root:

```json
{
  "scanDirs": ["app", "lib", "src/api"],
  "criticalTables": ["billing", "payments", "subscriptions", "disputes"]
}
```

- `scanDirs` — directories to walk. Defaults to `["app", "lib"]`.
- `criticalTables` — tables flagged with `critical` severity. Useful if you want a pre-commit hook that only blocks on revenue-critical changes (use `--ci-critical-only`). Default is empty (all findings are `high`).

CLI flags override the config file. Run `silent-write-audit --help` for the full list.

## Allowlist

Add `// silent-write-audit-ignore` on the line above (or on the same line as) an operation to suppress findings for that op. Useful when you have a deliberate dynamic payload, a known phantom that's actually correct (e.g., a column that exists on a different schema), or a transitional migration:

```ts
// silent-write-audit-ignore  -- migration 0042 lands tomorrow
await supabase.from('users').update({ new_field: x }).eq('id', userId)
```

## Pre-commit hook

There is an example pre-commit hook in `examples/pre-commit`. It runs the audit only on staged TypeScript changes and only fails on `critical` findings (so noise in dead-code paths doesn't block your commits).

```bash
cp examples/pre-commit .githooks/pre-commit
chmod +x .githooks/pre-commit
git config core.hooksPath .githooks
```

This is what we run on the CertNode monorepo. It has blocked silent-write bugs from shipping on every commit since 2026-05-05.

## What it covers (and what it doesn't)

**Covers:**
- `.update({...})`, `.upsert({...})`, `.insert({...})` payload keys
- `.select('col1, col2, joined(*)')` top-level projections
- All PostgREST filter methods that take a column-name as their first arg: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`, `is`, `in`, `contains`, `containedBy`, `range*`, `overlaps`, `textSearch`, `match`
- JSONB path expressions (`metadata->>field` resolves to base column `metadata`)
- TypeScript and TSX (uses the TypeScript compiler API, not regex)

**Does NOT cover (yet):**
- Drizzle, Prisma, TypeORM, or other ORM patterns. The audit is currently PostgREST/Supabase-JS specific. (If you need ORM support, please open an issue — we're prioritizing based on demand.)
- Spread operators in payloads (`{...obj}`). Can't be statically analyzed; will silently skip these objects.
- Joined-relation column filters (`.eq('related_table.col', value)`). Skipped to avoid false positives, since validation requires parsing the chain's `.select()` to know which embeds were declared.
- PostgreSQL direct connections. v0.2 will support `DATABASE_URL` and `pg_dump` schema files.

## CI integration

JSON output for parsing in CI:

```bash
npx silent-write-audit --json > audit.json
```

Same shape as the JSON example in the Sample output section above. CI parsers can read `summary.critical` directly to gate builds on critical-only findings.

Exit codes:
- `0` — no findings (or no critical findings if `--ci-critical-only`)
- `1` — findings present
- `2` — configuration / fatal error

## Why this exists

The bug class is real and unforgiving — PostgREST gives you no recovery path, just a silent rejection. Most teams discover these bugs through outages: a dispute that didn't get marked won, a billing flag that didn't flip, a webhook that quietly stopped persisting. The fix in code is one keystroke; the audit cost is the months of revenue you lost not knowing.

We built this to fix our own codebase. We're open-sourcing it because the bug class is the same shape in every PostgREST shop on Earth.

## ⸻ Audit-as-a-service

If you'd rather have someone external run this on your repo, triage the findings, and ship patch PRs — we offer that as a fixed-price service.

| Tier | Price | What you get | Best for |
|---|---|---|---|
| **Findings** | **$497** one-time | Audit run + ranked fix list (impact-scored). 3-day turnaround. | Teams with bandwidth to fix the bugs themselves |
| **Full delivery** | **$1,497** one-time | Everything in Findings + patch PRs for top 10 + pre-commit hook installed and configured. 7-day turnaround. | Bandwidth-limited shops; the default |
| **Watch** | **$4,997** / year | Quarterly audit re-runs + new-bug alerts as schema evolves + pre-commit hook maintained. | Teams that want ongoing protection past the first audit |

**No charge if we find fewer than 3 critical findings** — if your codebase is mostly clean, congrats, you owe nothing. (Applies to Findings and Full delivery tiers. "Critical" = phantom column on a revenue-tagged table per your `.silent-write-audit.json` config.)

**First 5 customers (Full delivery only): $1,197** with code `FIRST5` (a $300 founder's discount).

**Two ways to engage:**

- **Self-serve (FIRST5):** [pay $1,197 via Stripe](https://buy.stripe.com/28E6oH6hteRGbFxfkZ73G00) — we'll reach out within 24h to collect your schema-dump credential and start the audit.
- **Email first:** drop a note to **contact@certnode.io** with subject "silent-write audit — [your company]". Reply within 24h. Include stack confirmation (Postgres? Supabase? Stripe?), repo size estimate, and how to get a read-only schema dump (Supabase Management token, `pg_dump` URL, or a one-time schema file). Invoice on day 7 after PRs are merged or rejected.

This is run by the CertNode team — Stripe Partner (Apps track), 4 published Stripe Marketplace apps, primary author of the audit you just installed.

### What Watch delivers in detail

Watch is the recurring-protection tier. Concrete deliverables for $4,997/year:

- **Quarterly audit re-runs** — 4× per year against your live schema. We catch new phantom-column references that appeared since the last audit.
- **Pre-commit webhook integration** — every finding caught at commit time POSTs to your Slack / Discord / custom URL. See `examples/pre-commit-with-watch-webhook` for the install. Configure with `WATCH_WEBHOOK_URL` (and optional `WATCH_WEBHOOK_SECRET` for HMAC-signed payloads).
- **Priority 24h response** on new findings (vs the 7-day SLA on one-time tiers).
- **New-bug-class release notes** — when the audit logic gains new patterns (new ORM adapter, new column types, sibling tools we ship), Watch subscribers get a release-note email rather than discovering it on next quarterly run.
- **Annual aggregated trend report** — findings-over-time chart you can hand to your auditor or board (compliance-useful for SOC2 / ISO 27001 prep).
- **Pre-commit hook maintenance** — when you change Postgres provider, add tables, or evolve schema patterns, we update your `.silent-write-audit.json` config so the gate stays accurate without you maintaining it.

Watch can be cancelled at any time; we don't lock you into the year. Pro-rated refund on remaining quarters if you cancel mid-cycle.

### Audited by CertNode

If you've engaged the audit (paid or via the OSS tool) and your codebase is clean (or post-fix), you can publicly attest. We don't gate the badge — running the audit makes it yours:

```markdown
[![Audited by CertNode](https://img.shields.io/badge/Audited_by-CertNode-10b981)](https://github.com/srbryant86/silent-write-audit)
```

Renders as a small green pill in your README. Or a tweet template:

> *"Our codebase was audited for silent-write bugs by CertNode. \[N\] findings caught + fixed. The audit tool is open source: github.com/srbryant86/silent-write-audit"*

The badge isn't a certification — it's a public commitment to the bug class. The audit is reproducible by anyone with `npx`.

## Examples

- **`examples/pre-commit`** — basic pre-commit hook that blocks commits on critical findings.
- **`examples/pre-commit-with-watch-webhook`** — extended pre-commit for Watch-tier customers; same blocking behavior plus webhook POST on every finding.
- **`examples/sample-report.md`** — what a Full-delivery audit deliverable looks like. Real-shape with illustrative customer name; structure matches what paid customers receive.
- **`examples/audit-deliverable-template.md`** — the internal template auditors fill in. Published so customers can preview the deliverable structure before engaging.
- **`examples/auto-pr-template.md`** — patch-PR description format used in Full-delivery engagements. Lifts per-PR write-time from ~30min → ~5min and surfaces the revenue impact of each fix consistently across PRs.

## Roadmap

Each release below is **demand-gated** — built when a real user (not us) asks for it. We'd rather ship narrow on real signal than broad on speculation.

- **v0.2 — DATABASE_URL + `pg_dump` schema sources.** Drops the Supabase requirement; works on any Postgres + PostgREST stack. Gated on first non-Supabase user requesting it.
- **v0.3 — Drizzle and Prisma adapters.** Different parser path per ORM. Gated on first Drizzle/Prisma user opening an issue with a representative file.
- **v0.4 — `rpc()` parameter audit.** Stored-procedure call sites cross-referenced against `pg_proc` definitions.
- **Sibling tools (separate packages):** `stripe-webhook-audit` (idempotency + signing + retry), `supabase-rls-audit` (missing RLS on public tables), `stripe-api-version-audit` (deprecated patterns). Each independently useful, same shape as this audit.

Already shipped: published to npm as `@certnode/silent-write-audit` (latest v0.1.3). Install via `npm install -D @certnode/silent-write-audit` or run ad-hoc with `npx`.

## Contributing

Bug reports and PRs welcome. Please include a minimal reproducible example showing the bug class your patch addresses or fixes.

## License

MIT — see [LICENSE](./LICENSE).

## Author

Built at [CertNode](https://certnode.io). Contact at `contact@certnode.io`.
