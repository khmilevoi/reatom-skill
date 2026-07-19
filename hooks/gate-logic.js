const crypto = require('node:crypto')

const AUDITORS = [
  'audit-async',
  'audit-state',
  'audit-lifecycle',
  'audit-routing-forms',
  'audit-react'
]

const MAX_LISTED_FILES = 40

function computeMarker(changedFiles, headSha) {
  const basis = [...changedFiles].sort().join('\n') + '\n' + headSha
  return crypto.createHash('sha256').update(basis).digest('hex')
}

function auditableFiles(files) {
  const ignored = /(^|\/)(node_modules|dist|build)\//
  return files.filter((f) => /\.tsx?$/.test(f) && !/\.d\.ts$/.test(f) && !ignored.test(f))
}

const ALLOW = { block: false, writeMarker: false }

function gateDecision(ctx) {
  if (ctx.stopHookActive) return ALLOW
  if (!ctx.isGitRepo) return ALLOW
  if (!ctx.isReatomProject) return ALLOW
  if (!ctx.auditableFiles || ctx.auditableFiles.length === 0) return ALLOW
  if (ctx.marker && ctx.marker === ctx.lastMarker) return ALLOW

  return { block: true, writeMarker: true, reason: buildReason(ctx.auditableFiles) }
}

function buildReason(files) {
  const listed = files.slice(0, MAX_LISTED_FILES).join('\n')
  const rest = files.length > MAX_LISTED_FILES
    ? `\n…and ${files.length - MAX_LISTED_FILES} more`
    : ''

  return [
    'Reatom audit required before this session can finish.',
    '',
    'Changed TypeScript in this Reatom project:',
    listed + rest,
    '',
    'Dispatch these five read-only auditors IN PARALLEL, one Agent call each:',
    AUDITORS.map((a) => `  - ${a}`).join('\n'),
    '',
    'Each auditor reads the rule registry at',
    '${CLAUDE_PLUGIN_ROOT}/skills/reatom/references/rules.md and reports findings for its own domain only.',
    '',
    'Then, for every finding: fix it, or dismiss it with a written rationale.',
    'Finish with a line "Audit: N findings, M fixed, K dismissed" and spell out',
    'each dismissal and its rationale so the operator can judge it.'
  ].join('\n')
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

module.exports = { computeMarker, auditableFiles, gateDecision, DOMAINS, SURFACE, buildTriggers, routeFile }
