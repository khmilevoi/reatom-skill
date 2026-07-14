const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { computeMarker, auditableFiles, gateDecision } = require('./gate-logic')

const MARKER_FILE = 'reatom-audit-last'

function readStdin() {
  try {
    const raw = fs.readFileSync(0, 'utf8').trim()
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return r.status === 0 ? r.stdout : null
}

function isGitRepo(cwd) {
  return git(cwd, ['rev-parse', '--git-dir']) !== null
}

function headSha(cwd) {
  const out = git(cwd, ['rev-parse', 'HEAD'])
  return out ? out.trim() : 'NO_HEAD'
}

function isReatomProject(cwd) {
  const listed = git(cwd, ['ls-files', 'package.json', '*/package.json', '**/package.json'])
  if (listed === null) return false
  const files = [...new Set(listed.split('\n').map((s) => s.trim()).filter(Boolean))]
  for (const file of files) {
    try {
      if (/"@reatom\//.test(fs.readFileSync(path.join(cwd, file), 'utf8'))) return true
    } catch {
      // unreadable package.json → treat as no evidence
    }
  }
  return false
}

// Committed branch work plus the working tree. `architecture` only looks at
// uncommitted changes; agents commit mid-session, so that would go blind.
function changedFiles(cwd) {
  const base = git(cwd, ['merge-base', 'HEAD', 'main'])
  const committed = base ? git(cwd, ['diff', '--name-only', base.trim(), 'HEAD']) || '' : ''
  const working = git(cwd, ['diff', '--name-only', 'HEAD']) || ''
  const untracked = git(cwd, ['ls-files', '--others', '--exclude-standard']) || ''
  const all = [committed, working, untracked]
    .join('\n')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  return [...new Set(all)]
}

function markerPath(cwd) {
  const gitDir = git(cwd, ['rev-parse', '--git-dir'])
  const resolved = gitDir ? gitDir.trim() : '.git'
  return path.resolve(cwd, resolved, MARKER_FILE)
}

function readMarker(cwd) {
  try {
    return fs.readFileSync(markerPath(cwd), 'utf8').trim()
  } catch {
    return null
  }
}

function writeMarker(cwd, marker) {
  try {
    fs.writeFileSync(markerPath(cwd), marker + '\n')
  } catch {
    // fail-open: the marker is only an optimization
  }
}

function main() {
  const input = readStdin()
  const cwd = input.cwd || process.cwd()

  const ctx = {
    stopHookActive: Boolean(input.stop_hook_active),
    isGitRepo: false,
    isReatomProject: false,
    auditableFiles: [],
    marker: null,
    lastMarker: null
  }

  if (!ctx.stopHookActive) {
    ctx.isGitRepo = isGitRepo(cwd)
    if (ctx.isGitRepo) {
      ctx.lastMarker = readMarker(cwd)
      ctx.isReatomProject = isReatomProject(cwd)
      if (ctx.isReatomProject) {
        ctx.auditableFiles = auditableFiles(changedFiles(cwd))
        ctx.marker = computeMarker(ctx.auditableFiles, headSha(cwd))
      }
    }
  }

  const decision = gateDecision(ctx)
  if (decision.writeMarker && ctx.marker) writeMarker(cwd, ctx.marker)
  if (decision.block) {
    process.stdout.write(JSON.stringify({ decision: 'block', reason: decision.reason }) + '\n')
  }
}

main()
