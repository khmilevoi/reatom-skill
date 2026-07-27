const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { readState, statePath, parsePin } = require('./state')

const SOURCES_STATE = 'sources'
const NO_SOURCES = 'none'

// The branch the vendored handbook under references/upstream/ is cut from.
// Keeping them on the same ref is what lets the skill treat the two as one
// story told at two levels of detail.
const REF = 'v1001'
const REMOTE = 'https://github.com/reatom/reatom.git'

const CACHE_NAMESPACE = 'reatom-claude-plugin'
const CLONE_LEAF = 'sources'

// One clone per machine, in the OS cache location, because nothing about it is
// project-specific: every project wants the same 29 MB of reatom@v1001.
function defaultSourcesPath(env = process.env, platform = process.platform) {
  const base = platform === 'win32'
    ? env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
    : env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache')
  return path.join(base, CACHE_NAMESPACE, CLONE_LEAF)
}

// `.git` inside, not merely the directory: a half-deleted or freshly-made
// empty directory must not read as a checkout and send the skill reading
// files that are not there.
function isClone(dir, exists) {
  return Boolean(dir) && exists(path.join(dir, '.git'))
}

function resolveSources(cwd, { env, platform, exists = fs.existsSync } = {}) {
  const pin = parsePin(readState(cwd, SOURCES_STATE))
  const pinFile = statePath(cwd, SOURCES_STATE)

  if (pin && pin.value === NO_SOURCES) {
    return { status: 'disabled', path: null, pinFile, pinned: true }
  }

  if (pin) {
    return {
      status: isClone(pin.value, exists) ? 'ok' : 'pinned-missing',
      path: pin.value,
      pinFile,
      pinned: true
    }
  }

  const fallback = defaultSourcesPath(env, platform)
  return {
    status: isClone(fallback, exists) ? 'ok' : 'missing',
    path: fallback,
    pinFile,
    pinned: false
  }
}

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : null
}

// Revision and freshness are read out of the clone every time rather than
// recorded anywhere. A metadata file would need syncing, and a copy written
// into one project's state goes stale the moment another project updates the
// shared clone — revision is a property of the clone, not of a project.
function describeClone(clonePath, runGit = git) {
  const commit = runGit(clonePath, ['rev-parse', '--short', 'HEAD'])
  const iso = runGit(clonePath, ['log', '-1', '--format=%cI'])
  if (commit === null || iso === null) return null
  const branch = runGit(clonePath, ['rev-parse', '--abbrev-ref', 'HEAD'])
  return {
    commit,
    iso,
    date: iso.slice(0, 10),
    ref: branch && branch !== 'HEAD' ? branch : REF
  }
}

const DAY = 86400000

function ageInDays(iso, now = Date.now()) {
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return null
  return Math.max(0, Math.floor((now - then) / DAY))
}

// The age is printed on every success, not only when it is large. Updates only
// ever happen on `init`, so the standing risk is a clone quietly going stale;
// a date the agent sees on every lookup is what pays for that choice.
function report(cwd, deps = {}) {
  const resolved = resolveSources(cwd, deps)

  if (resolved.status === 'disabled') {
    return {
      ok: false,
      text:
        `sources: disabled for this project — ${resolved.pinFile} says "${NO_SOURCES}". ` +
        'Delete that line to re-enable them.'
    }
  }

  if (resolved.status === 'pinned-missing') {
    return {
      ok: false,
      text:
        `sources: pinned to ${resolved.path}, which is not a git checkout. ` +
        `Correct or delete ${resolved.pinFile}, then run /reatom-audit init.`
    }
  }

  if (resolved.status === 'missing') {
    return {
      ok: false,
      text:
        `sources: not cloned. Run /reatom-audit init to clone reatom/reatom@${REF} ` +
        `into ${resolved.path}.`
    }
  }

  const info = (deps.describe || describeClone)(resolved.path)
  if (info === null) {
    return {
      ok: false,
      text:
        `sources: ${resolved.path} exists but git cannot read it. ` +
        'Delete it and run /reatom-audit init.'
    }
  }

  const days = ageInDays(info.iso, deps.now)
  const age = days === null ? 'age unknown' : `${days} day${days === 1 ? '' : 's'} old`
  return {
    ok: true,
    text: [
      `path:   ${resolved.path}`,
      `ref:    ${info.ref}`,
      `commit: ${info.commit}  ${info.date}  (${age})`
    ].join('\n')
  }
}

function spawnGitStatus(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return { status: r.status === null ? 1 : r.status, stderr: r.stderr || '' }
}

function run(runGit, cwd, args) {
  const r = runGit(cwd, args)
  if (r.status !== 0) {
    const detail = (r.stderr || '').trim().split('\n').pop() || 'no output'
    throw new Error(`git ${args[0]} failed (exit ${r.status}): ${detail}`)
  }
}

// --depth 1 --single-branch is the difference between 29 MB and 300 MB: the
// tracked tree at v1001 is 29.3 MB, the full history is 271 MB. No sparse
// checkout — docs/ and examples/ are two of the three things the clone exists
// to provide.
//
// Update is fetch + hard reset, never pull: the clone is a read-only mirror
// nobody commits to, and a merge is a state this has no business entering.
function ensureSources({
  target,
  runGit = spawnGitStatus,
  exists = fs.existsSync,
  mkdir = (dir) => fs.mkdirSync(dir, { recursive: true })
} = {}) {
  const dest = target || defaultSourcesPath()

  if (isClone(dest, exists)) {
    run(runGit, dest, ['fetch', '--depth', '1', 'origin', REF])
    run(runGit, dest, ['reset', '--hard', 'FETCH_HEAD'])
    return { action: 'updated', path: dest }
  }

  const parent = path.dirname(dest)
  mkdir(parent)
  run(runGit, parent, ['clone', '--depth', '1', '--single-branch', '-b', REF, REMOTE, dest])
  return { action: 'cloned', path: dest }
}

module.exports = {
  REF,
  REMOTE,
  SOURCES_STATE,
  NO_SOURCES,
  defaultSourcesPath,
  resolveSources,
  describeClone,
  ageInDays,
  report,
  ensureSources
}

if (require.main === module) {
  const r = report(process.cwd())
  process.stdout.write(r.text + '\n')
  if (!r.ok) process.exitCode = 1
}
