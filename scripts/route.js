const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const {
  auditableFiles,
  buildTriggers,
  planAudit,
  parseCache,
  readIgnorePatterns,
  filterIgnored,
  formatOrders
} = require('./routing')

const REFERENCES = path.join(__dirname, '..', 'skills', 'reatom', 'references')

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return r.status === 0 ? r.stdout : null
}

function repoRoot(cwd) {
  const top = git(cwd, ['rev-parse', '--show-toplevel'])
  return top === null ? null : top.trim()
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

function gitDirPath(cwd, name) {
  const gitDir = git(cwd, ['rev-parse', '--git-dir'])
  return path.resolve(cwd, gitDir ? gitDir.trim() : '.git', name)
}

function baseWarning(ref, pinFile) {
  return ref
    ? `Reatom audit guessed the base branch as "${ref}" from the commit graph — ` +
      `no origin/HEAD and no ${BASE_CANDIDATES.join('/')} branch was found. ` +
      `This guess is rechecked automatically if a better answer shows up later. ` +
      `To pin it permanently instead, or to correct it, write the ref into ${pinFile}.`
    : `Reatom audit could not identify a base branch, so only working-tree changes ` +
      `are audited and committed branch work goes unchecked. This is rechecked ` +
      `automatically if a base branch appears later. To pin an answer permanently ` +
      `(or write "none" to silence this for good), edit ${pinFile}.`
}

const AUTO_SUFFIX = ' auto'

// A pin the router wrote itself is marked so it can be revisited cheaply later;
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
// pin (the router's own guess, or "nothing found") gets a cheap origin/HEAD +
// conventional-name recheck on every run, so a base branch that appears later
// is picked up without waiting on the guess to go stale on its own.
function resolveBaseRef(cwd) {
  const pinFile = gitDirPath(cwd, BASE_CACHE_FILE)
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

// Committed branch work plus the working tree. Uncommitted changes alone would
// go blind the moment an agent commits mid-session. A null baseRef means no
// base branch was found — the working tree is all that stays in scope.
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

// Everything the repository holds, tracked or not yet added. Index entries whose
// working-tree file is gone are dropped: an unreadable file fans out to every
// auditor, and a whole-repo sweep is the worst place to do that by accident.
function repositoryFiles(cwd) {
  const listed = git(cwd, ['ls-files', '--cached', '--others', '--exclude-standard', '--', '*.ts', '*.tsx'])
  if (listed === null) return []
  const all = [...new Set(listed.split('\n').map((s) => s.trim()).filter(Boolean))]
  return all.filter((f) => fs.existsSync(path.join(cwd, f)))
}

const CACHE_FILE = 'reatom-audit-last'

function readCache(cwd) {
  try {
    return parseCache(fs.readFileSync(gitDirPath(cwd, CACHE_FILE), 'utf8'))
  } catch {
    return {}
  }
}

function writeCache(cwd, cache) {
  try {
    fs.writeFileSync(gitDirPath(cwd, CACHE_FILE), JSON.stringify(cache) + '\n')
  } catch {
    // fail-open: the cache is only an optimization
  }
}

// The current name first, the pre-0.6 name second. An existing project keeps
// its exclusions across the rename without an edit; only the first file found
// is read, so the two never merge.
const IGNORE_FILES = ['.reatom-audit-ignore', '.reatom-gate-ignore']

function readIgnore(cwd) {
  for (const name of IGNORE_FILES) {
    try {
      return fs.readFileSync(path.join(cwd, name), 'utf8')
    } catch {
      // try the next name
    }
  }
  return null
}

function fail(message) {
  process.stdout.write(message + '\n')
  process.exitCode = 1
}

const USAGE =
  'Usage: route.js [--changed | --all | <path>…]\n' +
  '  --changed  (default) TypeScript changed against the base branch, plus the working tree\n' +
  '  --all      every TypeScript file in the repository\n' +
  '  <path>…    exactly the given files, changed or not'

// The bare words are accepted alongside the flags because they are what the
// operator types after `/reatom-audit`, and neither is a path that could ever
// be auditable TypeScript — so nothing is lost by reading them as the mode.
function resolveScope(args) {
  if (args.includes('--help') || args.includes('-h')) return { mode: 'help' }
  if (args[0] === '--all' || args[0] === 'all') return { mode: 'all' }
  if (args.length === 0 || args[0] === '--changed' || args[0] === 'changed') return { mode: 'changed' }
  if (args[0] === 'init') return { mode: 'init' }
  return { mode: 'paths', paths: args }
}

function main() {
  const args = process.argv.slice(2)
  const { mode, paths } = resolveScope(args)
  if (mode === 'help') {
    process.stdout.write(USAGE + '\n')
    return
  }
  if (mode === 'init') {
    return fail('init is not an audit scope — run scripts/init-claude-md.js instead.')
  }

  const cwd = process.cwd()
  let root = cwd
  let files = []
  let scope = ''
  let warning = null

  if (mode === 'paths') {
    files = auditableFiles(paths)
    scope = 'Scope: COUNT named on the command line. ' +
      'The ignore file is deliberately not applied — you asked for these by name.'
  } else {
    root = repoRoot(cwd)
    if (root === null) return fail('Not a git repository — --changed and --all need one. Name the files instead.')

    if (mode === 'all') {
      files = auditableFiles(repositoryFiles(root))
      scope = `Scope: every TypeScript file in ${root} — COUNT.`
    } else {
      const base = resolveBaseRef(root)
      warning = base.warning
      files = auditableFiles(changedFiles(root, base.ref))
      const against = base.ref ? `merge-base(HEAD, ${base.ref})..HEAD plus the working tree` : 'the working tree alone'
      scope = `Scope: changed TypeScript in ${root} — ${against}. COUNT.`
    }

    // After the count is spelled out, so the number matches what is listed.
    files = filterIgnored(files, readIgnorePatterns(readIgnore(root)))
  }
  scope = scope.replace('COUNT', `${files.length} file${files.length === 1 ? '' : 's'}`)

  if (warning) process.stdout.write(warning + '\n\n')

  if (files.length === 0) {
    process.stdout.write('No auditable TypeScript in scope.\n')
    return
  }

  let rules = null
  try {
    rules = fs.readFileSync(path.join(REFERENCES, 'rules.md'), 'utf8')
  } catch {
    return fail(
      `Cannot read the rule registry at ${path.join(REFERENCES, 'rules.md')} — the audit cannot run. ` +
      'Reinstall the plugin.'
    )
  }

  // Only a repository-derived scope shares the cache: its paths are repo-relative
  // and complete. Hand-named paths may be relative to anywhere, so they neither
  // read nor write it — and --all deliberately re-audits, so it only writes.
  const useCache = mode === 'changed'
  const plan = planAudit({
    files,
    readFile: (f) => fs.readFileSync(path.resolve(root, f), 'utf8'),
    readSlice: (d) => fs.readFileSync(path.join(REFERENCES, `rules-${d}.md`), 'utf8'),
    cache: useCache ? readCache(root) : {},
    triggers: buildTriggers(rules)
  })
  if (mode !== 'paths') writeCache(root, plan.nextCache)

  process.stdout.write(formatOrders(plan, scope) + '\n')
}

main()
