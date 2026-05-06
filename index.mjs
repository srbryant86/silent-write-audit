#!/usr/bin/env node
/**
 * silent-write-audit — phantom-column detector for Supabase/PostgREST writes
 *
 * Catches the silent-fail bug class where `.update({...})`, `.upsert({...})`,
 * `.insert({...})`, `.select('...')`, or filter calls (`.eq()`, `.neq()`, etc.)
 * reference a column that does not exist on the target table. PostgREST rejects
 * the entire query with a 400 / PGRST204 — and your code logs one line and
 * proceeds as if the write succeeded.
 *
 * Usage:
 *   silent-write-audit                       # scan ./app and ./lib (default)
 *   silent-write-audit --scan src,lib,api    # scan custom dirs
 *   silent-write-audit --staged              # only files staged in git
 *   silent-write-audit --json                # JSON output for CI
 *   silent-write-audit --refresh-schema      # bust the 24h schema cache
 *   silent-write-audit --ci-critical-only    # exit 1 only on critical findings
 *
 * Required env (one of):
 *   SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF
 *     → Pulls schema from the Supabase Management API.
 *
 * Loads .env and .env.local from cwd if present.
 *
 * Optional config: ./.silent-write-audit.json
 *   {
 *     "scanDirs": ["app", "lib"],          // override default scan dirs
 *     "criticalTables": ["billing", ...]   // tables flagged 'critical' (default: [])
 *   }
 *
 * Allowlist: add `// silent-write-audit-ignore` on or above a line to suppress.
 *
 * Exit codes:
 *   0  no findings (or no critical findings if --ci-critical-only)
 *   1  findings present (or critical findings if --ci-critical-only)
 *   2  configuration / fatal error
 */

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import ts from 'typescript'

const CWD = process.cwd()
const SCHEMA_CACHE_PATH = path.join(CWD, '.schema-cache.json')
const SCHEMA_TTL_MS = 24 * 60 * 60 * 1000

const COLUMN_FILTER_METHODS = new Set([
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte',
  'like', 'ilike', 'is', 'in',
  'contains', 'containedBy',
  'rangeGt', 'rangeGte', 'rangeLt', 'rangeLte',
  'rangeAdjacent', 'overlaps',
  'textSearch', 'match',
])
const PAYLOAD_METHODS = new Set(['update', 'upsert', 'insert'])
const SELECT_METHODS = new Set(['select'])

// ─── Env / config loading ───────────────────────────────────────────────────

function loadEnv() {
  for (const file of ['.env', '.env.local']) {
    const fullPath = path.join(CWD, file)
    if (!fs.existsSync(fullPath)) continue
    const content = fs.readFileSync(fullPath, 'utf8')
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\n]*)"?$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
    }
  }
}

function loadConfig() {
  const configPath = path.join(CWD, '.silent-write-audit.json')
  if (!fs.existsSync(configPath)) return { scanDirs: null, criticalTables: [] }
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    return {
      scanDirs: Array.isArray(cfg.scanDirs) ? cfg.scanDirs : null,
      criticalTables: Array.isArray(cfg.criticalTables) ? cfg.criticalTables : [],
    }
  } catch (err) {
    console.error(`[silent-write-audit] Failed to parse .silent-write-audit.json: ${err.message}`)
    process.exit(2)
  }
}

// ─── Schema fetch (Supabase Management API) ────────────────────────────────

async function fetchSchema(forceRefresh = false) {
  if (!forceRefresh && fs.existsSync(SCHEMA_CACHE_PATH)) {
    const stat = fs.statSync(SCHEMA_CACHE_PATH)
    if (Date.now() - stat.mtimeMs < SCHEMA_TTL_MS) {
      const cached = JSON.parse(fs.readFileSync(SCHEMA_CACHE_PATH, 'utf8'))
      const map = new Map()
      for (const [t, cols] of Object.entries(cached)) map.set(t, new Set(cols))
      return map
    }
  }

  const token = process.env.SUPABASE_ACCESS_TOKEN
  const projectRef = process.env.SUPABASE_PROJECT_REF
  if (!token || !projectRef) {
    console.error('[silent-write-audit] Required env vars missing.')
    console.error('  SUPABASE_ACCESS_TOKEN — Management API token (sbp_...)')
    console.error('  SUPABASE_PROJECT_REF  — your project ref (e.g. obasoslqkymvjyjbmlfv)')
    console.error('')
    console.error('  Token: https://supabase.com/dashboard/account/tokens')
    console.error('  Project ref: in Supabase project URL or Settings → General')
    process.exit(2)
  }

  const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`
  const sql = `
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })

  if (!res.ok) {
    console.error(`[silent-write-audit] Management API failed: ${res.status} ${res.statusText}`)
    console.error(await res.text())
    process.exit(2)
  }

  const rows = await res.json()
  const map = new Map()
  for (const row of rows) {
    if (!map.has(row.table_name)) map.set(row.table_name, new Set())
    map.get(row.table_name).add(row.column_name)
  }

  const cacheObj = {}
  for (const [t, cols] of map) cacheObj[t] = Array.from(cols)
  fs.writeFileSync(SCHEMA_CACHE_PATH, JSON.stringify(cacheObj, null, 2))

  return map
}

// ─── JSONB path recognition ────────────────────────────────────────────────

function isJsonbPath(col) {
  return col.includes('->>') || col.includes('->')
}
function getJsonbBase(col) {
  return col.split(/->>?/)[0].trim()
}

// ─── Allowlist ──────────────────────────────────────────────────────────────

function isAllowlisted(sourceFile, node) {
  const start = node.getStart(sourceFile)
  const lineStart = sourceFile.getLineAndCharacterOfPosition(start).line
  const lines = sourceFile.text.split(/\r?\n/)
  const onLine = lines[lineStart] || ''
  const aboveLine = lineStart > 0 ? lines[lineStart - 1] : ''
  const tag = 'silent-write-audit-ignore'
  return onLine.includes(tag) || aboveLine.includes(tag)
}

// ─── AST walking ────────────────────────────────────────────────────────────

function scanFile(filePath, content, schema, criticalTables) {
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const findings = []
  const relPath = path.relative(CWD, filePath).replace(/\\/g, '/')

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'from' &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      const tableName = node.arguments[0].text
      if (schema.has(tableName)) {
        const ops = collectChainOps(node)
        for (const op of ops) {
          const issues = analyzeOp(op, tableName, schema.get(tableName))
          for (const issue of issues) {
            if (isAllowlisted(sourceFile, op.callNode)) continue
            const { line } = sourceFile.getLineAndCharacterOfPosition(
              op.callNode.getStart(sourceFile)
            )
            findings.push({
              file: relPath,
              line: line + 1,
              table: tableName,
              op: op.method,
              ...issue,
              severity: criticalTables.has(tableName) ? 'critical' : 'high',
            })
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return findings
}

function collectChainOps(fromCall) {
  const ops = []
  let cursor = fromCall
  while (
    cursor.parent &&
    ts.isPropertyAccessExpression(cursor.parent) &&
    cursor.parent.parent &&
    ts.isCallExpression(cursor.parent.parent) &&
    cursor.parent.parent.expression === cursor.parent
  ) {
    const methodName = cursor.parent.name.text
    const callNode = cursor.parent.parent
    ops.push({ method: methodName, args: callNode.arguments, callNode })
    cursor = callNode
  }
  return ops
}

function analyzeOp(op, tableName, columnSet) {
  const issues = []

  if (PAYLOAD_METHODS.has(op.method)) {
    const payload = op.args[0]
    if (!payload) return issues
    const keys = extractObjectKeys(payload)
    if (keys === null) return issues
    const missing = keys.filter((k) => !columnExists(k, columnSet))
    if (missing.length > 0) {
      issues.push({ kind: `${op.method}_payload_phantom`, missing, all_keys: keys })
    }
    return issues
  }

  if (SELECT_METHODS.has(op.method)) {
    const arg = op.args[0]
    if (!arg) return issues
    if (!ts.isStringLiteralLike(arg)) return issues
    const cols = parseSelectString(arg.text)
    if (cols === null) return issues
    const missing = cols.filter((c) => !columnExists(c, columnSet))
    if (missing.length > 0) {
      issues.push({ kind: 'select_phantom', missing, all_keys: cols })
    }
    return issues
  }

  if (COLUMN_FILTER_METHODS.has(op.method)) {
    const arg = op.args[0]
    if (!arg) return issues
    if (!ts.isStringLiteralLike(arg)) return issues
    const col = arg.text.trim()
    if (col.length === 0) return issues
    if (col.includes('.') && !isJsonbPath(col)) return issues
    if (!columnExists(col, columnSet)) {
      issues.push({ kind: `filter_phantom_${op.method}`, missing: [col], all_keys: [col] })
    }
    return issues
  }

  return issues
}

function columnExists(col, columnSet) {
  if (!col) return true
  if (isJsonbPath(col)) return columnSet.has(getJsonbBase(col))
  return columnSet.has(col)
}

function extractObjectKeys(payload) {
  let inner = payload
  while (
    ts.isParenthesizedExpression(inner) ||
    ts.isAsExpression(inner) ||
    ts.isTypeAssertionExpression?.(inner)
  ) {
    inner = inner.expression
  }
  if (!ts.isObjectLiteralExpression(inner)) return null

  const keys = []
  for (const prop of inner.properties) {
    if (ts.isSpreadAssignment(prop)) continue
    if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
      const name = prop.name
      if (ts.isIdentifier(name)) keys.push(name.text)
      else if (ts.isStringLiteralLike(name)) keys.push(name.text)
    }
    if (ts.isMethodDeclaration(prop) && ts.isIdentifier(prop.name)) {
      keys.push(prop.name.text)
    }
  }
  return keys
}

function parseSelectString(str) {
  if (!str) return null
  if (str.trim() === '*') return []
  const tokens = []
  let depth = 0
  let buf = ''
  for (let i = 0; i < str.length; i++) {
    const c = str[i]
    if (c === '(') { depth++; buf += c; continue }
    if (c === ')') { depth--; buf += c; continue }
    if (c === ',' && depth === 0) {
      tokens.push(buf.trim())
      buf = ''
      continue
    }
    buf += c
  }
  if (buf.trim()) tokens.push(buf.trim())

  const cols = []
  for (const tok of tokens) {
    if (/\(.*\)/.test(tok)) continue
    const colName = tok.split(':')[0].trim()
    const noCast = colName.split('::')[0].trim()
    if (noCast === '*') continue
    if (noCast.length > 0) cols.push(noCast)
  }
  return cols
}

// ─── File walking + staged-files mode ──────────────────────────────────────

function walkDir(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      walkDir(full, fileList)
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      fileList.push(full)
    }
  }
  return fileList
}

function getStagedFiles() {
  try {
    const out = execSync('git diff --cached --name-only --diff-filter=ACM', {
      cwd: CWD,
      encoding: 'utf8',
    })
    return out
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
      .map((f) => path.join(CWD, f))
      .filter((f) => fs.existsSync(f))
  } catch (err) {
    console.error('[silent-write-audit] Failed to get staged files:', err.message)
    return []
  }
}

// ─── Output ─────────────────────────────────────────────────────────────────

function renderHuman(findings) {
  if (findings.length === 0) {
    console.log('[silent-write-audit] ✓ No phantom-column issues found.')
    return
  }
  const critical = findings.filter((f) => f.severity === 'critical')
  const high = findings.filter((f) => f.severity === 'high')

  console.log(
    `\n[silent-write-audit] ⚠ Found ${findings.length} issue(s) ` +
    `(${critical.length} critical, ${high.length} high)\n`
  )
  for (const f of findings) {
    const tag = f.severity === 'critical' ? '🔥 CRITICAL' : '⚠️  HIGH'
    console.log(`${tag}  ${f.file}:${f.line}`)
    console.log(`         table: ${f.table}.${f.op}`)
    console.log(`         missing: ${f.missing.join(', ')}`)
    if (f.kind.startsWith('select') || f.kind.startsWith('filter')) {
      console.log(`         (PostgREST 400s the entire query — returns null data, silent fail)`)
    } else if (f.kind.endsWith('_payload_phantom')) {
      console.log(`         (PostgREST PGRST204 rejects the entire ${f.op} — silent fail)`)
    }
    console.log('')
  }
  console.log(`Tip: add \`// silent-write-audit-ignore\` on the line above an op to allowlist it.`)
}

function renderJson(findings) {
  console.log(JSON.stringify({
    findings,
    summary: {
      total: findings.length,
      critical: findings.filter((f) => f.severity === 'critical').length,
      high: findings.filter((f) => f.severity === 'high').length,
    },
  }, null, 2))
}

// ─── Main ───────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    json: false,
    staged: false,
    refreshSchema: false,
    criticalOnly: false,
    scanDirs: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') args.json = true
    else if (a === '--staged') args.staged = true
    else if (a === '--refresh-schema') args.refreshSchema = true
    else if (a === '--ci-critical-only') args.criticalOnly = true
    else if (a === '--scan' || a === '--scan-dirs') {
      const v = argv[i + 1]
      if (!v) { console.error('--scan requires a comma-separated list of directories'); process.exit(2) }
      args.scanDirs = v.split(',').map((s) => s.trim()).filter(Boolean)
      i++
    } else if (a === '--help' || a === '-h') {
      console.log(`silent-write-audit — phantom-column detector for Supabase/PostgREST writes

Usage:
  silent-write-audit                       # scan ./app and ./lib (default)
  silent-write-audit --scan src,lib,api    # scan custom dirs
  silent-write-audit --staged              # only files staged in git
  silent-write-audit --json                # JSON output for CI
  silent-write-audit --refresh-schema      # bust the 24h schema cache
  silent-write-audit --ci-critical-only    # exit 1 only on critical findings

Required env:
  SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF

Optional config:  ./.silent-write-audit.json
Allowlist:        // silent-write-audit-ignore  on or above a line
`)
      process.exit(0)
    }
  }
  return args
}

async function main() {
  loadEnv()
  const args = parseArgs(process.argv.slice(2))
  const config = loadConfig()
  const criticalTables = new Set(config.criticalTables)

  const schema = await fetchSchema(args.refreshSchema)
  if (!args.json) console.log(`[silent-write-audit] Schema loaded: ${schema.size} tables`)

  const scanDirs = args.scanDirs || config.scanDirs || ['app', 'lib']
  const files = args.staged
    ? getStagedFiles()
    : scanDirs.flatMap((d) => walkDir(path.join(CWD, d)))
  if (!args.json) console.log(`[silent-write-audit] Scanning ${files.length} files...`)

  const findings = []
  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8')
    findings.push(...scanFile(filePath, content, schema, criticalTables))
  }

  findings.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1
    if (a.file !== b.file) return a.file.localeCompare(b.file)
    return a.line - b.line
  })

  if (args.json) renderJson(findings)
  else renderHuman(findings)

  const failable = args.criticalOnly
    ? findings.filter((f) => f.severity === 'critical')
    : findings
  process.exit(failable.length > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('[silent-write-audit] Fatal:', err)
  process.exit(2)
})
