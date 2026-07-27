const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const {
  gitDir,
  statePath,
  readState,
  writeState,
  parsePin,
  formatPin,
  STATE_DIR
} = require('../../scripts/state')

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reatom-state-'))
  spawnSync('git', ['init', '-q'], { cwd: dir, encoding: 'utf8' })
  return dir
}

test('parsePin reads the auto suffix, the bare value, and nothing', () => {
  assert.deepEqual(parsePin('main auto\n'), { value: 'main', auto: true })
  assert.deepEqual(parsePin('  main  '), { value: 'main', auto: false })
  assert.equal(parsePin('   '), null)
  assert.equal(parsePin(null), null)
})

test('formatPin marks a tooling-written pin and leaves a manual one bare', () => {
  assert.equal(formatPin('main'), 'main auto\n')
  assert.equal(formatPin('main', { auto: false }), 'main\n')
})

test('formatPin and parsePin round-trip a Windows path containing spaces', () => {
  const value = 'C:\\Users\\Ann Lee\\AppData\\Local\\reatom-claude-plugin\\sources'
  assert.deepEqual(parsePin(formatPin(value)), { value, auto: true })
})

test('state lands in .reatom-plugin inside the git dir', () => {
  const dir = makeRepo()
  assert.equal(writeState(dir, 'sources', 'x\n'), true)
  assert.equal(fs.readFileSync(path.join(dir, '.git', STATE_DIR, 'sources'), 'utf8'), 'x\n')
  assert.equal(readState(dir, 'sources'), 'x\n')
  assert.equal(statePath(dir, 'sources'), path.join(dir, '.git', STATE_DIR, 'sources'))
})

test('a pre-0.7 flat state file is still read', () => {
  const dir = makeRepo()
  fs.writeFileSync(path.join(dir, '.git', 'reatom-base-branch'), 'develop\n')
  assert.equal(readState(dir, 'base-branch'), 'develop\n')
})

test('the new state file wins over the legacy one', () => {
  const dir = makeRepo()
  fs.writeFileSync(path.join(dir, '.git', 'reatom-base-branch'), 'stale\n')
  writeState(dir, 'base-branch', 'fresh\n')
  assert.equal(readState(dir, 'base-branch'), 'fresh\n')
})

test('outside a git repository there is no state and nothing is created', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reatom-nogit-'))
  assert.equal(gitDir(dir), null)
  assert.equal(statePath(dir, 'sources'), null)
  assert.equal(readState(dir, 'sources'), null)
  assert.equal(writeState(dir, 'sources', 'x\n'), false)
  assert.equal(fs.existsSync(path.join(dir, '.git')), false, 'never fabricate a .git directory')
})
