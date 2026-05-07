# Silent-Write Audit — Deliverable Template

> Internal template for the Full-delivery tier ($1,497). Auditor fills in the bracketed fields after running the tool against the customer's codebase. Pair with the JSON output (`silent-write-audit --json`) to make the per-finding fill-in mechanical.

---

# Silent-Write Audit — [CUSTOMER NAME]

**Customer:** [CUSTOMER LEGAL NAME]
**Scan date:** [YYYY-MM-DD]
**Codebase:** [APPROX LINES] lines [TS/JS], [STACK SUMMARY]
**Schema source:** [Supabase Management API / pg_dump file / DATABASE_URL]
**Findings:** [N] total ([N] critical, [N] high)
**Engagement tier:** [Findings $497 / Full $1,497 / Watch $4,997/yr]
**Auditor:** CertNode (`contact@certnode.io`)

---

## Executive summary

[2–4 sentences. The single most-damaging finding stated plainly with revenue or compliance impact named. The "tldr that this customer would forward to their CTO."]

**Highest-revenue-impact finding:** [one-sentence summary] Estimated revenue exposure: [$X if calculable; else "see C-X for impact analysis"].

**Pre-commit hook recommendation:** [installed and tested on fork awaiting merge / installed and merged / not installed (Findings tier — customer installs themselves)].

---

## Findings by severity

### 🔥 CRITICAL ([N])

#### C-1. [ONE-LINE TITLE WITH IMPACT FRAMING]

- **File:** `[path/to/file.ts:LINE]`
- **Operation:** `[table].[op]`
- **Phantom columns:** `[col1]`, `[col2]`
- **Why critical:** [2–3 sentences explaining the runtime behavior — what fires, what silently fails, what downstream code is gated on the failed write]
- **Fix:** [Concrete recommendation. Rename, remove, move-to-metadata, add migration. Estimated lines of change.]
- **Patch PR:** [PR-link or "deferred to customer-side"]
- **Verification:** [How the customer confirms the fix worked. Manual test, automated test added, etc.]

#### C-2. [...]

(Repeat structure for each critical finding.)

---

### ⚠️ HIGH ([N])

(Same structure as critical, severity downgraded because business impact is bounded — e.g., non-revenue table, internal-only path, or already-rare runtime branch.)

#### H-1. [...]

(Repeat for each high finding.)

---

## Pre-commit hook installation

[If installed:]
We've installed `silent-write-audit` as a pre-commit hook on a fork of your repo, configured to:
- Run on staged TypeScript files only
- Block on critical findings (using the critical-table list we've ranked for your stack: `[table1]`, `[table2]`, ...)
- Allow high findings (logged as warnings, don't block)

The hook is in `.githooks/pre-commit`. Configure your repo to use it:

```bash
git config core.hooksPath .githooks
```

We've tested against the last [N] commits in your `main` branch — [none would have been blocked / X commits would have been blocked, listed in PR-Y].

[If Findings-tier (no install):]
The pre-commit hook example is in our open-source repo at `examples/pre-commit`. Install with:

```bash
curl -o .githooks/pre-commit https://raw.githubusercontent.com/srbryant86/silent-write-audit/main/examples/pre-commit
chmod +x .githooks/pre-commit
git config core.hooksPath .githooks
```

---

## What's covered / what's not

**Covered:**
- `.update()`, `.upsert()`, `.insert()`, `.select()`, and all PostgREST filter chains in `[scanDirs from config]`
- TypeScript + TSX (TypeScript compiler API)
- JSONB path expressions
- Schema as of [SCAN_DATE]

**Not covered (tool limitation):**
- [Drizzle/Prisma/TypeORM call sites if any — list count and files, flag for v0.3]
- [Spread operators in payloads — list count and files if customer has any]
- [Stored procedure calls (.rpc) if customer uses any]
- [Other limitations specific to this customer's codebase]

---

## Recommendations beyond findings

[Customize 2–4 bullets per customer. Common ones:]

1. **[Pattern recommendation specific to what the audit surfaced.]**
2. **[Schema-evolution / migration-discipline recommendation.]**
3. **[Watch tier upsell if applicable: "your schema evolved [N] tables in last 30 days; quarterly re-audit subscription...".]**

---

## Engagement summary

- Audit ran: [SCAN_DATE]
- Total findings: [N] ([N] critical, [N] high)
- Patch PRs shipped: [N] ([Top 10 by revenue impact / Findings tier — no PRs] )
- Pre-commit hook: [installed and ready for merge / installed and merged / not installed]
- Walkthrough call: [scheduled / completed / not applicable]
- Invoice: [$497 / $1,497 / $0 (fewer than 3 critical findings — see "no charge" promise)]

Questions or follow-up: `contact@certnode.io`.

---

## Auditor notes (internal — not part of customer deliverable)

[Auditor fills in for internal record-keeping. Not shared with customer.]

- **Findings retention rate** (after customer review): [X of N findings accepted as real bugs]
- **False-positive count:** [N]
- **Time to deliver:** [hours]
- **Notable patterns for tool roadmap:** [things that surfaced from this codebase that the tool should learn]
- **Customer-fit retrospective:** [was this a good ICP fit? what made the engagement clean or messy?]
- **Watch upsell pitch landed?:** [Y/N, with reason]
