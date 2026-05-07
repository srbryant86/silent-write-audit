# silent-write-audit

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
- Bitcoin timestamp anchoring that had been broken since the file shipped (phantom `pdf_stripe_file_id`)
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

Output shape:

```json
{
  "findings": [
    {
      "file": "app/api/webhooks/stripe/route.ts",
      "line": 142,
      "table": "disputes",
      "op": "update",
      "kind": "update_payload_phantom",
      "missing": ["won", "evidence_score"],
      "all_keys": ["status", "won", "evidence_score", "updated_at"],
      "severity": "critical"
    }
  ],
  "summary": { "total": 1, "critical": 1, "high": 0 }
}
```

Exit codes:
- `0` — no findings (or no critical findings if `--ci-critical-only`)
- `1` — findings present
- `2` — configuration / fatal error

## Why this exists

The bug class is real and unforgiving — PostgREST gives you no recovery path, just a silent rejection. Most teams discover these bugs through outages: a dispute that didn't get marked won, a billing flag that didn't flip, a webhook that quietly stopped persisting. The fix in code is one keystroke; the audit cost is the months of revenue you lost not knowing.

We built this to fix our own codebase. We're open-sourcing it because the bug class is the same shape in every PostgREST shop on Earth.

## ⸻ Audit-as-a-service

If you'd rather have someone external run this on your repo, triage the findings, and ship patch PRs — we offer that as a fixed-price service.

**Silent-Write Audit — $1,497 flat, 7 days.**

For your $1,497, in 7 calendar days, you get:

1. The full audit (this tool, plus our own extensions for spread-handling and joined-table filters)
2. A ranked fix list ordered by estimated revenue impact (webhooks updating billing rank above logging-only updates)
3. Patch PRs for the top 10 findings against your repo (we work on a fork, you merge)
4. The pre-commit hook installed and configured

**No charge if findings are zero** — if your codebase is already clean, congrats, you owe nothing.

**First 5 customers: $1,197** with code `FIRST5` (a $300 founder's discount).

Email **contact@certnode.io** with subject "silent-write audit — [your company]" and we'll reply within 24 hours. Include: stack confirmation (Postgres? Supabase? Stripe?), repo size estimate, and how to get a read-only schema dump (Supabase Management token, `pg_dump` URL, or a one-time schema file).

This is run by the CertNode team — Stripe Partner (Apps track), 4 published Stripe Marketplace apps, primary author of the audit you just installed.

## Roadmap

- v0.2 — direct `DATABASE_URL` and `pg_dump` schema sources (drop the Supabase requirement)
- v0.3 — Drizzle and Prisma adapters
- v0.4 — Postgres function (`select`, `rpc`) parameter audit
- v0.5 — npm publish under `@certnode/silent-write-audit`

## Contributing

Bug reports and PRs welcome. Please include a minimal reproducible example showing the bug class your patch addresses or fixes.

## License

MIT — see [LICENSE](./LICENSE).

## Author

Built at [CertNode](https://certnode.io). Contact at `contact@certnode.io`.
