const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { auditableFiles, gateDecision, parseCache, planAudit, buildTriggers } = require('./gate-logic')

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

const BASE_CANDIDATES = ['main', 'master', 'develop', 'trunk']

function refExists(cwd, ref) {
  return git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) !== null
}

// Never hits the network: origin/HEAD is a local symbolic ref written by
// `clone` and `git remote set-head`, and the candidate list is pure ref lookup.
function detectBaseRef(cwd) {
  const head = git(cwd, ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD'])
  if (head !== null) {
    const ref = head.trim()
    if (ref && refExists(cwd, ref)) return { ref, guessed: false }
  }

  for (const name of BASE_CANDIDATES) {
    for (const ref of [`refs/heads/${name}`, `refs/remotes/origin/${name}`]) {
      if (refExists(cwd, ref)) return { ref, guessed: false }
    }
  }

  return { ref: null, guessed: true }
}

// Committed branch work plus the working tree. `architecture` only looks at
// uncommitted changes; agents commit mid-session, so that would go blind.
// A null baseRef means no base branch was found — the working tree is all
// that stays in scope, which is the pre-detection behaviour.
function changedFiles(cwd, baseRef) {
  const base = baseRef ? git(cwd, ['merge-base', 'HEAD', baseRef]) : null
  const committed = base ? git(cwd, ['diff', '--diff-filter=d', '--name-only', base.trim(), 'HEAD']) || '' : ''
  const working = git(cwd, ['diff', '--diff-filter=d', '--name-only', 'HEAD']) || ''
  const untracked = git(cwd, ['ls-files', '--others', '--exclude-standard']) || ''
  const all = [committed, working, untracked]
    .join('\n')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  return [...new Set(all)]
}

const REFERENCES = path.join(__dirname, '..', 'skills', 'reatom', 'references')
const CACHE_FILE = 'reatom-audit-last'

function cachePath(cwd) {
  const gitDir = git(cwd, ['rev-parse', '--git-dir'])
  const resolved = gitDir ? gitDir.trim() : '.git'
  return path.resolve(cwd, resolved, CACHE_FILE)
}

function readCache(cwd) {
  try {
    return parseCache(fs.readFileSync(cachePath(cwd), 'utf8'))
  } catch {
    return {}
  }
}

function writeCache(cwd, cache) {
  try {
    fs.writeFileSync(cachePath(cwd), JSON.stringify(cache) + '\n')
  } catch {
    // fail-open: the cache is only an optimization
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
    plan: null
  }

  if (!ctx.stopHookActive) {
    ctx.isGitRepo = isGitRepo(cwd)
    if (ctx.isGitRepo) {
      ctx.isReatomProject = isReatomProject(cwd)
      if (ctx.isReatomProject) {
        ctx.auditableFiles = auditableFiles(changedFiles(cwd, detectBaseRef(cwd).ref))
        if (ctx.auditableFiles.length > 0) {
          let rules = null
          try {
            rules = fs.readFileSync(path.join(REFERENCES, 'rules.md'), 'utf8')
          } catch {
            // fail-open: an unreadable registry leaves ctx.plan null
          }
          if (rules !== null) {
            ctx.plan = planAudit({
              files: ctx.auditableFiles,
              readFile: (f) => fs.readFileSync(path.join(cwd, f), 'utf8'),
              readSlice: (d) => fs.readFileSync(path.join(REFERENCES, `rules-${d}.md`), 'utf8'),
              cache: readCache(cwd),
              triggers: buildTriggers(rules)
            })
          }
        }
      }
    }
  }

  const decision = gateDecision(ctx)
  if (decision.writeCache && decision.cache) writeCache(cwd, decision.cache)
  if (decision.block) {
    process.stdout.write(JSON.stringify({ decision: 'block', reason: decision.reason }) + '\n')
  }
}

main()
