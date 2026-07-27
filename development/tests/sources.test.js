const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const {
  defaultSourcesPath,
  resolveSources,
  REF
} = require('../../scripts/sources')
const { writeState } = require('../../scripts/state')

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reatom-sources-'))
  spawnSync('git', ['init', '-q'], { cwd: dir, encoding: 'utf8' })
  return dir
}

// A directory that reads as a clone: resolveSources looks for .git inside,
// so a leftover empty directory must not pass for a checkout.
function makeClone() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reatom-clone-'))
  fs.mkdirSync(path.join(dir, '.git'))
  return dir
}

test('the clone lives under LOCALAPPDATA on Windows', () => {
  const p = defaultSourcesPath({ LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' }, 'win32')
  assert.equal(p, path.join('C:\\Users\\a\\AppData\\Local', 'reatom-claude-plugin', 'sources'))
})

test('the clone honours XDG_CACHE_HOME elsewhere', () => {
  const p = defaultSourcesPath({ XDG_CACHE_HOME: '/x/cache' }, 'linux')
  assert.equal(p, path.join('/x/cache', 'reatom-claude-plugin', 'sources'))
})

test('without XDG_CACHE_HOME the clone falls back to ~/.cache', () => {
  const p = defaultSourcesPath({}, 'linux')
  assert.equal(p, path.join(os.homedir(), '.cache', 'reatom-claude-plugin', 'sources'))
})

test('an unpinned project with no clone reports missing, naming the default path', () => {
  const dir = makeRepo()
  const r = resolveSources(dir, { env: { XDG_CACHE_HOME: '/nope' }, platform: 'linux' })
  assert.equal(r.status, 'missing')
  assert.equal(r.path, path.join('/nope', 'reatom-claude-plugin', 'sources'))
})

test('an unpinned project resolves against a clone sitting at the default path', () => {
  const dir = makeRepo()
  const env = { XDG_CACHE_HOME: '/x/cache' }
  const expected = path.join('/x/cache', 'reatom-claude-plugin', 'sources')
  const r = resolveSources(dir, {
    env,
    platform: 'linux',
    exists: (p) => p === path.join(expected, '.git')
  })
  assert.equal(r.status, 'ok')
  assert.equal(r.path, expected)
  assert.equal(r.pinned, false)
})

test('a directory without .git inside does not pass for a checkout', () => {
  const dir = makeRepo()
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'reatom-empty-'))
  writeState(dir, 'sources', empty + ' auto\n')
  assert.equal(resolveSources(dir).status, 'pinned-missing')
})

test('a pinned path that is a clone wins over the default', () => {
  const dir = makeRepo()
  const clone = makeClone()
  writeState(dir, 'sources', clone + ' auto\n')
  const r = resolveSources(dir)
  assert.equal(r.status, 'ok')
  assert.equal(r.path, clone)
  assert.equal(r.pinned, true)
})

test('a pin pointing at nothing says so rather than falling back silently', () => {
  const dir = makeRepo()
  writeState(dir, 'sources', path.join(os.tmpdir(), 'reatom-gone-12345') + '\n')
  const r = resolveSources(dir)
  assert.equal(r.status, 'pinned-missing')
  assert.match(r.pinFile, /[\\/]\.reatom-plugin[\\/]sources$/)
})

test('a pin of "none" disables sources for the project', () => {
  const dir = makeRepo()
  writeState(dir, 'sources', 'none\n')
  assert.equal(resolveSources(dir).status, 'disabled')
})

test('the ref is the branch the vendored handbook tracks', () => {
  assert.equal(REF, 'v1001')
})

const { describeClone, ageInDays, report } = require('../../scripts/sources')

const SOURCES = path.join(__dirname, '..', '..', 'scripts', 'sources.js')

// A real, tiny, offline git repository standing in for the clone.
function makeRealClone() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reatom-realclone-'))
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  git(['init', '-q', '-b', 'v1001'])
  git(['config', 'user.email', 't@t'])
  git(['config', 'user.name', 't'])
  fs.writeFileSync(path.join(dir, 'README.md'), '# reatom\n')
  git(['add', '.'])
  git(['commit', '-q', '-m', 'seed'])
  return dir
}

test('describeClone reads the revision, date and branch out of the checkout', () => {
  const clone = makeRealClone()
  const info = describeClone(clone)
  assert.match(info.commit, /^[0-9a-f]{7,}$/)
  assert.match(info.date, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(info.ref, 'v1001')
})

test('describeClone returns null when the directory is not a checkout', () => {
  assert.equal(describeClone(os.tmpdir(), () => null), null)
})

test('ageInDays counts whole days and never goes negative', () => {
  const now = Date.parse('2026-07-27T00:00:00Z')
  assert.equal(ageInDays('2026-07-19T00:00:00Z', now), 8)
  assert.equal(ageInDays('2026-07-27T06:00:00Z', now), 0, 'a clock skew is not a negative age')
  assert.equal(ageInDays('not a date', now), null)
})

test('the report prints path, ref and a dated commit with its age', () => {
  const dir = makeRepo()
  const clone = makeRealClone()
  writeState(dir, 'sources', clone + ' auto\n')
  const r = report(dir, {
    describe: () => ({ commit: '06a7f7a1', iso: '2026-07-19T00:00:00Z', date: '2026-07-19', ref: 'v1001' }),
    now: Date.parse('2026-07-27T00:00:00Z')
  })
  assert.equal(r.ok, true)
  assert.match(r.text, /^path:   /m)
  assert.match(r.text, /^ref:    v1001$/m)
  assert.match(r.text, /^commit: 06a7f7a1  2026-07-19  \(8 days old\)$/m)
})

test('a missing clone names the command that would create it', () => {
  const dir = makeRepo()
  const r = report(dir, { env: { XDG_CACHE_HOME: '/nope' }, platform: 'linux' })
  assert.equal(r.ok, false)
  assert.match(r.text, /\/reatom-audit init/)
  assert.match(r.text, /v1001/)
})

test('a disabled project is told so and is not nagged to initialise', () => {
  const dir = makeRepo()
  writeState(dir, 'sources', 'none\n')
  const r = report(dir)
  assert.equal(r.ok, false)
  assert.match(r.text, /disabled/)
  assert.ok(!r.text.includes('/reatom-audit init'), 'do not argue with a stated decision')
})

test('a stale pin names both the path and the file holding it', () => {
  const dir = makeRepo()
  const gone = path.join(os.tmpdir(), 'reatom-gone-98765')
  writeState(dir, 'sources', gone + '\n')
  const r = report(dir)
  assert.equal(r.ok, false)
  assert.ok(r.text.includes(gone), 'the dead path')
  assert.match(r.text, /sources/, 'and the pin file to fix')
})

test('a checkout that exists but git cannot read is an error with its own wording', () => {
  const dir = makeRepo()
  const clone = makeClone()
  writeState(dir, 'sources', clone + ' auto\n')
  const r = report(dir, {
    describe: () => null
  })
  assert.equal(r.ok, false)
  assert.match(r.text, /exists but git cannot read it/)
  assert.match(r.text, /Delete it and run \/reatom-audit init/)
})

test('integration: the CLI exits 1 and says why when there is no clone', () => {
  const dir = makeRepo()
  const out = spawnSync('node', [SOURCES], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, XDG_CACHE_HOME: path.join(os.tmpdir(), 'reatom-empty-cache'), LOCALAPPDATA: path.join(os.tmpdir(), 'reatom-empty-cache') }
  })
  assert.equal(out.status, 1)
  assert.match(out.stdout, /\/reatom-audit init/)
})

const { ensureSources, REMOTE } = require('../../scripts/sources')

function recorder(status = 0, stderr = '') {
  const calls = []
  return {
    calls,
    runGit: (cwd, args) => {
      calls.push({ cwd, args })
      return { status, stderr }
    }
  }
}

test('a fresh machine gets a shallow, single-branch clone of the pinned ref', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'reatom-ensure-'))
  const target = path.join(parent, 'sources')
  const rec = recorder()
  const r = ensureSources({ target, runGit: rec.runGit })

  assert.equal(r.action, 'cloned')
  assert.equal(r.path, target)
  assert.equal(rec.calls.length, 1)
  assert.deepEqual(rec.calls[0].args, [
    'clone', '--depth', '1', '--single-branch', '-b', 'v1001', REMOTE, target
  ])
})

test('an existing clone is fetched and hard-reset, never merged', () => {
  const target = makeClone()
  const rec = recorder()
  const r = ensureSources({ target, runGit: rec.runGit })

  assert.equal(r.action, 'updated')
  assert.deepEqual(rec.calls.map((c) => c.args), [
    ['fetch', '--depth', '1', 'origin', 'v1001'],
    ['reset', '--hard', 'FETCH_HEAD']
  ])
  assert.equal(rec.calls[0].cwd, target, 'the update runs inside the clone')
})

test('a failing git command throws with the command and its stderr', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'reatom-ensure-fail-'))
  const rec = recorder(128, 'fatal: unable to access ... Could not resolve host\n')
  assert.throws(
    () => ensureSources({ target: path.join(parent, 'sources'), runGit: rec.runGit }),
    (e) => {
      assert.match(e.message, /git clone/)
      assert.match(e.message, /128/)
      assert.match(e.message, /Could not resolve host/)
      return true
    }
  )
})

test('ensureSources defaults to the machine cache path when given no target', () => {
  const rec = recorder()
  const r = ensureSources({ runGit: rec.runGit, exists: () => false, mkdir: () => {} })
  assert.equal(r.path, defaultSourcesPath())
})

const INIT = path.join(__dirname, '..', '..', 'scripts', 'init.js')

// init.js is a CLI with no injection seam, so the sources half is steered
// entirely through the cache-location environment: a cache root that cannot
// hold a directory fails deterministically and offline, and a pre-made clone
// at the expected path makes the update path a local no-op.
function runInit(dir, env = {}) {
  return spawnSync('node', [INIT], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, ...env }
  })
}

test('integration: init writes the CLAUDE.md block even when the clone fails', () => {
  const dir = makeRepo()
  // A *file* where the cache root must be a directory. mkdir fails, so the
  // sources half fails without a network call and without depending on
  // whether this machine can reach github.com.
  const cache = path.join(dir, 'cache-is-a-file')
  fs.writeFileSync(cache, 'not a directory\n')
  const out = runInit(dir, { XDG_CACHE_HOME: cache, LOCALAPPDATA: cache })

  assert.equal(out.status, 1, 'a half-success is reported as a failure')
  assert.match(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), /## Reatom audit/)
  assert.match(out.stdout, /CLAUDE\.md:/)
  assert.match(out.stdout, /sources:\s+FAILED/)
  assert.match(out.stdout, /init/, 'and says how to retry')
})

test('integration: init pins the clone it found and reports its revision', () => {
  const dir = makeRepo()
  const clone = makeRealClone()
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'reatom-cacheroot-'))
  // Put the pre-made clone exactly where init would look, so the update path
  // runs against a local repo with no remote to reach.
  const dest = path.join(cacheRoot, 'reatom-claude-plugin', 'sources')
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.cpSync(clone, dest, { recursive: true })
  spawnSync('git', ['remote', 'add', 'origin', clone], { cwd: dest, encoding: 'utf8' })
  spawnSync('git', ['branch', '-M', 'v1001'], { cwd: dest, encoding: 'utf8' })

  const out = runInit(dir, { XDG_CACHE_HOME: cacheRoot, LOCALAPPDATA: cacheRoot })
  assert.equal(out.status, 0, out.stdout + out.stderr)
  assert.match(out.stdout, /sources:\s+updated/)

  const pin = fs.readFileSync(path.join(dir, '.git', '.reatom-plugin', 'sources'), 'utf8')
  assert.equal(pin.trim(), dest + ' auto')

  // And the resolver the skill calls now answers.
  const resolved = spawnSync('node', [SOURCES], { cwd: dir, encoding: 'utf8' })
  assert.equal(resolved.status, 0, resolved.stdout)
  assert.match(resolved.stdout, /ref:    v1001/)
})
