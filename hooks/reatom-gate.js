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

const MAX_HEURISTIC_REFS = 50

// Last resort: whichever other branch HEAD most recently diverged from. The
// youngest merge-base wins — an older shared ancestor means a more distant
// relative, not the branch this work forked off.
function guessBaseRef(cwd) {
  const listed = git(cwd, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes/origin'])
  if (listed === null) return null

  const current = (git(cwd, ['symbolic-ref', '-q', 'HEAD']) || '').trim()
  // A pushed, up-to-date branch shares a zero-distance merge-base with its own
  // remote-tracking ref, so it would win and diff the branch against itself.
  const mirror = current ? current.replace('refs/heads/', 'refs/remotes/origin/') : ''
  const refs = listed
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    // refs/remotes/origin/HEAD is a symbolic alias already tried first; keeping
    // it would double-count whatever branch it points at.
    .filter((r) => r !== current && r !== mirror && r !== 'refs/remotes/origin/HEAD')
    .slice(0, MAX_HEURISTIC_REFS)

  let best = null
  for (const ref of refs) {
    const mergeBase = git(cwd, ['merge-base', 'HEAD', ref])
    if (mergeBase === null) continue
    const stamp = git(cwd, ['log', '-1', '--format=%ct', mergeBase.trim()])
    if (stamp === null) continue
    const when = Number(stamp.trim())
    if (!Number.isFinite(when)) continue
    if (best === null || when > best.when) best = { ref, when }
  }
  return best ? best.ref : null
}

function refExists(cwd, ref) {
  return git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) !== null
}

// Never hits the network: origin/HEAD is a local symbolic ref written by
// `clone` and `git remote set-head`, and the candidate list is pure ref lookup.
// Cheap enough to re-run on every resolve, unlike the heuristic below.
function cheapBaseRef(cwd) {
  const head = git(cwd, ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD'])
  if (head !== null) {
    const ref = head.trim()
    if (ref && refExists(cwd, ref)) return ref
  }

  for (const name of BASE_CANDIDATES) {
    for (const ref of [`refs/heads/${name}`, `refs/remotes/origin/${name}`]) {
      if (refExists(cwd, ref)) return ref
    }
  }

  return null
}

function detectBaseRef(cwd) {
  const cheap = cheapBaseRef(cwd)
  if (cheap) return { ref: cheap, guessed: false }

  const guess = guessBaseRef(cwd)
  return { ref: guess, guessed: true }
}

const BASE_CACHE_FILE = 'reatom-base-branch'
const NO_BASE = 'none'

function baseCachePath(cwd) {
  const gitDir = git(cwd, ['rev-parse', '--git-dir'])
  return path.resolve(cwd, gitDir ? gitDir.trim() : '.git', BASE_CACHE_FILE)
}

function baseWarning(ref, pinFile) {
  return ref
    ? `Reatom gate guessed the base branch as "${ref}" from the commit graph — ` +
      `no origin/HEAD and no ${BASE_CANDIDATES.join('/')} branch was found. ` +
      `This guess is rechecked automatically if a better answer shows up later. ` +
      `To pin it permanently instead, or to correct it, write the ref into ${pinFile}.`
    : `Reatom gate could not identify a base branch, so only working-tree changes ` +
      `are audited and committed branch work goes unchecked. This is rechecked ` +
      `automatically if a base branch appears later. To pin an answer permanently ` +
      `(or write "none" to silence this for good), edit ${pinFile}.`
}

const AUTO_SUFFIX = ' auto'

// A pin the gate wrote itself is marked so it can be revisited cheaply later;
// a pin the operator wrote by hand (no suffix) is trusted forever, which is
// the whole point of letting them override a wrong guess.
function parsePin(raw) {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed.endsWith(AUTO_SUFFIX)) {
    return { value: trimmed.slice(0, -AUTO_SUFFIX.length), auto: true }
  }
  return { value: trimmed, auto: false }
}

function writePin(pinFile, value) {
  try {
    fs.writeFileSync(pinFile, value + AUTO_SUFFIX + '\n')
  } catch {
    // fail-open: the pin is only a shortcut, detection already answered
  }
}

// The pin exists so detection runs once and so the operator has somewhere
// concrete to correct a wrong answer. A manually-written pin (no auto suffix)
// is trusted forever — that is what the operator asked for. An auto-written
// pin (the gate's own guess, or "nothing found") gets a cheap origin/HEAD +
// conventional-name recheck on every run, so a base branch that appears later
// is picked up without waiting on the guess to go stale on its own.
function resolveBaseRef(cwd) {
  const pinFile = baseCachePath(cwd)
  let raw = null
  try {
    raw = fs.readFileSync(pinFile, 'utf8')
  } catch {
    // no pin yet → detect below
  }
  const pin = raw ? parsePin(raw) : null

  if (pin && !pin.auto) {
    if (pin.value === NO_BASE) return { ref: null, warning: null }
    if (refExists(cwd, pin.value)) return { ref: pin.value, warning: null }
    // manual pin no longer resolves → fall through to fresh detection
  } else if (pin && pin.auto) {
    const cheap = cheapBaseRef(cwd)
    if (cheap) {
      writePin(pinFile, cheap)
      return { ref: cheap, warning: null }
    }
    if (pin.value === NO_BASE) return { ref: null, warning: null }
    if (refExists(cwd, pin.value)) return { ref: pin.value, warning: null }
    // stale auto guess → fall through to fresh detection
  }

  const { ref, guessed } = detectBaseRef(cwd)
  writePin(pinFile, ref || NO_BASE)
  return { ref, warning: guessed ? baseWarning(ref, pinFile) : null }
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

  let warning = null

  if (!ctx.stopHookActive) {
    ctx.isGitRepo = isGitRepo(cwd)
    if (ctx.isGitRepo) {
      ctx.isReatomProject = isReatomProject(cwd)
      if (ctx.isReatomProject) {
        const base = resolveBaseRef(cwd)
        warning = base.warning
        ctx.auditableFiles = auditableFiles(changedFiles(cwd, base.ref))
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

  // systemMessage is orthogonal to decision: the base-branch warning must reach
  // the operator on runs where there is nothing to block on.
  const output = {}
  if (decision.block) {
    output.decision = 'block'
    output.reason = decision.reason
  }
  if (warning) output.systemMessage = warning
  if (Object.keys(output).length > 0) process.stdout.write(JSON.stringify(output) + '\n')
}

main()
