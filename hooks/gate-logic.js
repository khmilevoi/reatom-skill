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
    'skills/reatom/references/rules.md and reports findings for its own domain only.',
    '',
    'Then, for every finding: fix it, or dismiss it with a written rationale.',
    'Finish with a line "Audit: N findings, M fixed, K dismissed" and spell out',
    'each dismissal and its rationale so the operator can judge it.'
  ].join('\n')
}

module.exports = { computeMarker, auditableFiles, gateDecision }
