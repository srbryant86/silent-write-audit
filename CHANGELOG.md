# Changelog

All notable changes to this project will be documented in this file.

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
