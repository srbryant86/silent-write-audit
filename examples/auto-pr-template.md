# Auto-PR Description Template

> Used per finding when shipping patch PRs against a customer's repo (Full delivery tier). One PR per finding by default; group only when fixes are mechanically identical (e.g., same column rename across N call sites). Cuts each PR description from ~30 min of bespoke writing to ~5 min of template fill-in.

---

## PR title

```
fix([scope]): [one-line description] — silent-write phantom-column on [table]
```

Examples:
- `fix(disputes): persist dispute outcomes — silent-write phantom-column on disputes`
- `fix(billing): unbreak refund mark — silent-write phantom-column on payments`
- `fix(connect): deauth flag now flips — silent-write phantom-column on connected_accounts`

---

## PR body template

```markdown
## What this fixes

`[table].[operation]` at `[file:line]` references column(s) that don't exist on
the target table:

- `[phantom_col_1]` — should be `[real_col_1 OR move-to-metadata]`
- `[phantom_col_2]` — should be `[real_col_2 OR move-to-metadata]`

PostgREST silently rejects the entire query when any column is phantom (returns
`{ data: null, error: PGRST204 }`). Without this fix, the operation fails
silently at runtime — your code logs one line and continues as if the write
succeeded.

## Why this matters

[1–2 sentences naming the user-visible / revenue impact. Examples:]

- **dispute outcome write:** "Dispute outcomes haven't been persisting. Every
  won dispute since [date] has been silently dropped by Postgres; downstream
  fee-charging gated on `disputes.status === 'won'` never fires. Revenue
  exposure: [N] won disputes × [average fee] = [$X] in unbilled fees."
- **refund mark:** "Refunded charges remain flagged as `paid` in dashboards
  because the refund webhook's update silently fails. Compliance risk under
  [GDPR / PCI / your auditor's review]."
- **deauth flag:** "Deauthorized merchant accounts continue receiving webhooks
  because the deauth handler's `charges_enabled = false` update silently
  fails. Operational risk: stale webhook traffic + accounting
  reconciliation drift."

## What changed

[Be specific. List the lines changed.]

- `[file:line]` — renamed `[phantom_col]` → `[real_col]` in payload
- `[file:line]` — moved `[phantom_col]` to `metadata.[col]` (JSONB)
- `[migration-file]` — added migration `[YYYYMMDD_add_real_col.sql]` (if a
  new column is the right answer)

## Verification

[Specific verification step. Not "tests pass" — "this specific behavior changed."]

1. Apply this PR locally
2. [Specific test: trigger a dispute resolution / fire a refund webhook /
   deauth a connected account / etc.]
3. Confirm `[table].[col]` now updates correctly
4. (Optional) Run `silent-write-audit` against the changed file:
   ```
   npx silent-write-audit --staged --ci-critical-only
   ```
   Should report 0 critical findings on the touched files.

## Testing notes

[Any non-obvious testing context. If a test was added in this PR, name it.
If a test wasn't added, name why.]

- Added `[test-file]:[describe-block]` regression test (covers
  the exact phantom-column shape).
- [OR] No new test added — existing `[test-file]` covers this behavior;
  the bug existed because the test was checking against a stub, not
  the real schema.

## Related

- Audit deliverable: `[link to audit-report.md if customer-internal]`
- Tool: [`@certnode/silent-write-audit`](https://github.com/srbryant86/silent-write-audit)
- Bug class: PostgREST silently rejects entire query on any phantom column.
  See [README](https://github.com/srbryant86/silent-write-audit#the-bug-class)
  for full explanation.
- Pre-commit hook to prevent recurrence:
  `examples/pre-commit` in the audit repo (already installed in this PR if
  Full-delivery tier; manual install for Findings tier).

---

🤖 Generated as part of the silent-write-audit Full-delivery engagement.
Auditor: CertNode (`contact@certnode.io`).
```

---

## When to deviate from the template

- **Multi-call-site rename:** if the same column rename needs to land in 5+ call sites and the fix is mechanically identical, group them in one PR with an "All call sites" section listing each `file:line`. Don't ship 5 nearly-identical PRs.

- **Migration required:** if the right fix is to add a column (not rename or move-to-metadata), include the migration SQL inline and flag the deploy ordering: "merge migration first, then this PR."

- **Customer prefers a different fix path:** if the customer has reviewed the audit report and indicated preference (e.g., "we're moving to Drizzle anyway, just remove the call site"), defer to their preference. Note in the PR description: "Per customer guidance: removing rather than renaming."

- **Finding turns out to be a false positive on review:** close the PR without merging, document in the audit report under "False positives caught during review," and don't count toward the customer's invoiced findings count.

---

## Inputs the template needs

To fill in the template mechanically from a finding, you need:

| Field | Source |
|---|---|
| `[scope]` | Logical area: `disputes`, `billing`, `webhooks`, etc. — pick from customer's PR convention. |
| `[table]`, `[operation]` | From `silent-write-audit --json` output: `findings[].table`, `findings[].op`. |
| `[file:line]` | From `findings[].file` + `findings[].line`. |
| `[phantom_col_*]` | From `findings[].missing` array. |
| `[real_col_*]` | Auditor judgment based on schema inspection — usually obvious; sometimes requires asking customer. |
| Revenue / impact framing | Auditor analysis based on which downstream code is gated on the failed write. |

A future tooling improvement could auto-generate 80% of this template from the JSON finding + schema; the remaining 20% (revenue framing, fix path) is judgment work.
