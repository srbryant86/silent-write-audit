# Changelog

All notable changes to this project will be documented in this file.

## [0.1.3] — 2026-05-07

### Added
- `examples/pre-commit-with-watch-webhook` — extended pre-commit hook with Watch-tier webhook integration. POSTs JSON findings (with optional HMAC-SHA256 signature via `WATCH_WEBHOOK_SECRET`) to a customer-supplied `WATCH_WEBHOOK_URL` on every commit-time audit run. Recurring-value mechanism for the $4,997/year Watch tier.
- `examples/sample-report.md` — illustrative-shape Full-delivery audit deliverable. Lets prospects preview the report structure before engaging.
- `examples/audit-deliverable-template.md` — internal template auditors fill in per engagement. Published so customers can see the structure.
- `examples/auto-pr-template.md` — patch-PR description format for Full-delivery engagements. Cuts per-PR write-time ~30min → ~5min while surfacing revenue impact consistently.
- README "What Watch delivers in detail" subsection — concrete deliverables for the $4,997/year tier (quarterly re-audits, webhook integration, 24h SLA on new findings, new-bug-class release notes, annual trend report, pre-commit hook maintenance).
- README "Audited by CertNode" attestation pattern — paste-ready badge + tweet template for customers who've engaged the audit. Not gated; running the audit makes the badge yours.
- README "Examples" section linking the new artifacts.

### Changed
- No code changes in this release; the `index.mjs` audit logic is unchanged from 0.1.2. The version bump is for README + examples additions that warrant a republish so `npm view` shows the latest documentation.

## [0.1.2] — 2026-05-06

### Changed
- Authorship metadata switched from indie-founder form to company form. `package.json` author is now `CertNode <contact@certnode.io>`; LICENSE copyright is `SRB Creative Holdings LLC (CertNode)`; README Author section reads `Built at CertNode`. No code changes.

## [0.1.1] — 2026-05-06

### Fixed
- `bin` field now uses string form (`"bin": "./index.mjs"`) so npm publishes the CLI shim correctly. The 0.1.0 publish stripped the `bin` entry due to a strict-validation warning on the object form, leaving `npx @certnode/silent-write-audit` non-functional. 0.1.1 restores it.
- `repository.url` normalized to `git+https://...` form to match npm convention.

### Removed
- README pre-publish-disclaimer line (no longer relevant now that `@certnode/silent-write-audit` is on npm).

## [0.1.0] — 2026-05-06

Initial public release. Extracted from CertNode's internal audit tooling.

### Added
- Static analysis of `.update()`, `.upsert()`, `.insert()`, `.select()`, and PostgREST filter chains (`.eq()`, `.neq()`, `.gt()`, etc.) against the live database schema.
- Phantom-column detection: identifies columns referenced in code that don't exist on the target table.
- Schema source: Supabase Management API (with 24h local cache) — direct `pg_dump` and DATABASE_URL support coming in v0.2.
- JSONB path recognition (`metadata->>field`, `data->'a'->>'b'` resolve to base column).
- Inline allowlist via `// silent-write-audit-ignore` comment.
- JSON output mode (`--json`) for CI integration.
- Staged-only mode (`--staged`) for pre-commit hooks.
- Severity tagging by user-defined critical-table list (`.silent-write-audit.json`).
- Example pre-commit hook that runs the audit on staged TypeScript changes.

### Known limitations
- Schema source: Supabase Management API only. PostgreSQL direct connection (DATABASE_URL) and `pg_dump` schema files come in v0.2.
- ORM detection: only PostgREST/Supabase JS client patterns. Drizzle/Prisma/TypeORM auditing is on the roadmap (open an issue if you need it).
- Spread operators in payloads (`{...obj}`) are skipped (can't be statically analyzed).
- Joined-relation column filters (`.eq('related.col', v)`) are skipped to avoid false positives.

### Origin

This tool was built to fix our own production bugs. Pointed at our own codebase (CertNode, ~80k lines of TypeScript), it found ~50 silent-write bugs in a single night, including dispute outcomes that hadn't been persisting for weeks, billing flags that never flipped after deauthorization, and a GDPR redaction handler that was a silent no-op. The pre-commit hook variant has been blocking new bugs of this class on every commit since 2026-05-05.
