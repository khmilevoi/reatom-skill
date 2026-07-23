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
  planAudit
}
