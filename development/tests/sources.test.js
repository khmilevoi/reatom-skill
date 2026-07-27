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
