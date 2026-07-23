const crypto = require('node:crypto')

const MAX_LISTED_FILES = 40

function auditableFiles(files) {
  const ignored = /(^|\/)(node_modules|dist|build)\//
  return files.filter((f) => /\.tsx?$/.test(f) && !/\.d\.ts$/.test(f) && !ignored.test(f))
}

const AUDITOR_OF = {
  async: 'audit-async',
  state: 'audit-state',
  lifecycle: 'audit-lifecycle',
  'routing-forms': 'audit-routing-forms',
  react: 'audit-react'
}

const ALLOW = { block: false, writeCache: false }

function gateDecision(ctx) {
  if (ctx.stopHookActive) return ALLOW
  if (!ctx.isGitRepo) return ALLOW
  if (!ctx.isReatomProject) return ALLOW
  if (!ctx.auditableFiles || ctx.auditableFiles.length === 0) return ALLOW
  if (!ctx.plan) return ALLOW

  const dispatched = DOMAINS.filter((d) => ctx.plan.assignments[d])
  // Nothing new to audit, but the pruned cache is still worth persisting.
  if (dispatched.length === 0) return { block: false, writeCache: true, cache: ctx.plan.nextCache }

  return {
    block: true,
    writeCache: true,
    cache: ctx.plan.nextCache,
    reason: buildReason(ctx.plan, dispatched)
  }
}

function buildReason(plan, dispatched) {
  const orders = dispatched.map((domain) => {
    const files = plan.assignments[domain]
    const listed = files.slice(0, MAX_LISTED_FILES)
    const rest = files.length > MAX_LISTED_FILES
      ? [`  …and ${files.length - MAX_LISTED_FILES} more — audit them too`]
      : []
    return [
      `${AUDITOR_OF[domain]} (references/rules-${domain}.md)`,
      ...listed.map((f) => `  ${f}`),
      ...rest
    ].join('\n')
  })

  const lines = [
    'Reatom audit required before this session can finish.',
    '',
    'TRIAGE FIRST — judge every file listed below from this conversation\'s',
    'context alone; do not open or inspect the files. The gate reads the git',
    'diff and cannot tell whose changes these are. Ask of each file:',
    'did this session change it, directly or through subagents or tools it ran?',
    '- Changed by this session, or unsure: keep it. When unsure, audit — a',
    '  redundant audit is cheap, a silent skip is not.',
    '- Not changed by this session (a consultation-only session, or a change',
    '  made outside it): remove the file from every list below; an auditor',
    '  whose list becomes empty is not dispatched. The gate will not ask',
    '  about these changes again, so report the skip to the operator in one',
    '  line naming the files, and note they can run /reatom-audit <paths>',
    '  for a one-off check or add the paths to .reatom-gate-ignore to',
    '  exclude them from the gate permanently.',
    '',
    'Dispatch these auditors IN PARALLEL, one Agent call each, giving each the',
    'file list under its own name and nothing else:',
    '',
    orders.join('\n'),
    ''
  ]

  const idle = plan.notDispatched.map((d) => AUDITOR_OF[d])
  if (idle.length > 0) lines.push(`Not dispatched — no matching code: ${idle.join(', ')}`)
  const cached = plan.fullyCached.map((d) => AUDITOR_OF[d])
  if (cached.length > 0) lines.push(`Fully cached — routed but already audited: ${cached.join(', ')}`)
  if (plan.skipped > 0) {
    lines.push(`Skipped — unchanged since last audit: ${plan.skipped} pair${plan.skipped === 1 ? '' : 's'}`)
  }

  lines.push(
    '',
    'Then, for every finding: fix it, or dismiss it with a written rationale.',
    'Finish with a line "Audit: N findings, M fixed, K dismissed" and spell out',
    'each dismissal and its rationale so the operator can judge it.'
  )
  return lines.join('\n')
}

const DOMAINS = ['async', 'state', 'lifecycle', 'routing-forms', 'react']

// Broader than the union of all triggers on purpose: a file matching SURFACE but
// no trigger is auditable code the table does not recognise, and it must reach
// every auditor rather than be dropped.
const SURFACE = [
  'atom', 'computed', 'action', 'effect(', 'reatom',
  'useState', 'useEffect', 'useMemo', 'useCallback', 'useRef',
  'await', 'async ', 'Promise', '.then(', 'subscribe',
  'addEventListener', 'setInterval', 'setTimeout',
  'localStorage', 'sessionStorage', 'fetch(', 'window.', 'document.'
]

function buildTriggers(rulesText) {
  const triggers = Object.fromEntries(DOMAINS.map((d) => [d, new Set()]))
  for (const block of rulesText.split(/^### /m).slice(1)) {
    const domain = (block.match(/^- domain: (.+)$/m) || [])[1]
    const line = (block.match(/^- trigger: (.+)$/m) || [])[1]
    if (!domain || !line || !triggers[domain]) continue
    for (const token of line.split(',').map((t) => t.trim()).filter(Boolean)) {
      triggers[domain].add(token)
    }
  }
  return Object.fromEntries(DOMAINS.map((d) => [d, [...triggers[d]]]))
}

function routeFile(filePath, contents, triggers) {
  if (!SURFACE.some((token) => contents.includes(token))) return []
  const matched = DOMAINS.filter((d) => triggers[d].some((token) => contents.includes(token)))
  if (matched.length === 0) return [...DOMAINS]
  if (/\.tsx$/.test(filePath) && !matched.includes('react')) matched.push('react')
  return DOMAINS.filter((d) => matched.includes(d))
}

// NUL separates the pair, not a space or a colon: a path may legally contain
// either, and a key collision here reads as "already audited".
function pairKey(file, domain) {
  return `${file}\u0000${domain}`
}

function pairHash(fileContents, sliceContents) {
  return crypto.createHash('sha256').update(fileContents + '\u0000' + sliceContents).digest('hex')
}

function parseCache(raw) {
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed
  } catch {
    return {}
  }
}

function readIgnorePatterns(raw) {
  if (typeof raw !== 'string') return []
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
}

// A hand-written subset of gitignore matching (the repo has no dependencies):
// '*' and '?' stay inside one path segment, '**' crosses segments, any slash
// anchors the pattern to the project root, a trailing slash means everything
// under that directory, and a slashless pattern matches any single segment at
// any depth. Negation is deliberately unsupported.
function compilePattern(pattern) {
  let p = pattern
  let dirOnly = false
  if (p.endsWith('/')) {
    dirOnly = true
    p = p.slice(0, -1)
  }
  let anchored = false
  if (p.startsWith('/')) {
    anchored = true
    p = p.slice(1)
  }
  if (p.includes('/')) anchored = true

  // '\u0001' cannot appear in a path; it marks '**' segments so the glob
  // translation below cannot confuse them with characters the segment
  // translation already escaped. Order matters: '**/' first (zero or more
  // whole segments), then a trailing '/**' (everything under), then '**'
  // standing alone.
  const body = p
    .split('/')
    .map((seg) =>
      seg === '**'
        ? '\u0001'
        : seg
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*/g, '[^/]*')
            .replace(/\?/g, '[^/]')
    )
    .join('/')
    .split('\u0001/').join('(?:[^/]+/)*')
    .split('/\u0001').join('/.*')
    .split('\u0001').join('.*')

  const head = anchored ? '^' : '(?:^|/)'
  // A match on a directory segment must also drop everything under it, so a
  // non-dirOnly pattern accepts either end-of-path or a following slash.
  const tail = dirOnly ? '/' : '(?:/|$)'
  return new RegExp(`${head}(?:${body})${tail}`)
}

function filterIgnored(files, patterns) {
  if (!patterns || patterns.length === 0) return files
  const compiled = patterns.map(compilePattern)
  return files.filter((f) => !compiled.some((re) => re.test(f)))
}

function planAudit({ files, readFile, readSlice, cache, triggers }) {
  const slices = Object.fromEntries(DOMAINS.map((d) => [d, safeRead(() => readSlice(d), '')]))
  const assignments = {}
  // Tracked separately from `assignments`: a domain can have files routed to it
  // that are all cache hits, which must not read the same as no file ever
  // reaching it at all.
  const routed = new Set()
  const nextCache = {}
  let skipped = 0

  for (const file of files) {
    let contents = null
    try {
      contents = readFile(file)
    } catch {
      contents = null
    }
    // Unreadable means unknown, and unknown must not read as clean.
    const domains = contents === null ? [...DOMAINS] : routeFile(file, contents, triggers)

    for (const domain of domains) {
      routed.add(domain)
      const key = pairKey(file, domain)
      const hash = pairHash(contents === null ? '' : contents, slices[domain])
      nextCache[key] = hash
      if (cache[key] === hash) {
        skipped += 1
        continue
      }
      if (!assignments[domain]) assignments[domain] = []
      assignments[domain].push(file)
    }
  }

  return {
    assignments,
    notDispatched: DOMAINS.filter((d) => !routed.has(d)),
    fullyCached: DOMAINS.filter((d) => routed.has(d) && !assignments[d]),
    skipped,
    nextCache
  }
}

function safeRead(fn, fallback) {
  try {
    const value = fn()
    return typeof value === 'string' ? value : fallback
  } catch {
    return fallback
  }
}

module.exports = {
  auditableFiles,
  gateDecision,
  DOMAINS,
  SURFACE,
  buildTriggers,
  routeFile,
  pairKey,
  pairHash,
  parseCache,
  readIgnorePatterns,
  filterIgnored,
  planAudit
}

