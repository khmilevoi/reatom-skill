const { test } = require('node:test')
const assert = require('node:assert/strict')
const { computeMarker, auditableFiles, gateDecision } = require('../../hooks/gate-logic')

const base = {
  stopHookActive: false,
  isGitRepo: true,
  isReatomProject: true,
  auditableFiles: ['src/model.ts'],
  marker: 'M1',
  lastMarker: null
}

test('computeMarker is deterministic and order-independent', () => {
  assert.equal(computeMarker(['b', 'a'], 'sha'), computeMarker(['a', 'b'], 'sha'))
  assert.notEqual(computeMarker(['a', 'b'], 'sha'), computeMarker(['a', 'b'], 'other'))
})

test('auditableFiles keeps ts/tsx and drops everything else', () => {
  assert.deepEqual(
    auditableFiles([
      'src/a.ts',
      'src/b.tsx',
      'README.md',
      'dist/c.ts',
      'build/d.tsx',
      'src/e.d.ts',
      'node_modules/pkg/f.ts'
    ]),
    ['src/a.ts', 'src/b.tsx']
  )
})

test('gateDecision blocks only when every condition holds', () => {
  assert.equal(gateDecision(base).block, true)
  assert.equal(gateDecision({ ...base, stopHookActive: true }).block, false)
  assert.equal(gateDecision({ ...base, isGitRepo: false }).block, false)
  assert.equal(gateDecision({ ...base, isReatomProject: false }).block, false)
  assert.equal(gateDecision({ ...base, auditableFiles: [] }).block, false)
  assert.equal(gateDecision({ ...base, lastMarker: 'M1' }).block, false)
})

test('allow paths do not write a marker they never computed', () => {
  assert.equal(gateDecision({ ...base, stopHookActive: true }).writeMarker, false)
  assert.equal(gateDecision({ ...base, isReatomProject: false }).writeMarker, false)
})

test('a blocking decision records the marker', () => {
  assert.equal(gateDecision(base).writeMarker, true)
})

test('the block reason names all five auditors, the registry, and the files', () => {
  const { reason } = gateDecision(base)
  for (const agent of ['audit-async', 'audit-state', 'audit-lifecycle', 'audit-routing-forms', 'audit-react']) {
    assert.ok(reason.includes(agent), `reason names ${agent}`)
  }
  assert.match(reason, /rules\.md/)
  assert.match(reason, /src\/model\.ts/)
  assert.match(reason, /dismiss/i)
})

test('the block reason truncates very long file lists', () => {
  const many = Array.from({ length: 50 }, (_, i) => `src/f${i}.ts`)
  const { reason } = gateDecision({ ...base, auditableFiles: many })
  assert.match(reason, /and 10 more/)
})

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const GATE = path.join(__dirname, '..', '..', 'hooks', 'reatom-gate.js')

function makeRepo({ reatom = true, changed = 'src/model.ts' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reatom-gate-'))
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  git(['init', '-q', '-b', 'main'])
  git(['config', 'user.email', 't@t'])
  git(['config', 'user.name', 't'])
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(
      reatom
        ? { name: 'app', dependencies: { '@reatom/core': '1001.0.0' } }
        : { name: 'app', dependencies: { react: '19.0.0' } },
      null,
      2
    )
  )
  fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed')
  git(['add', '.'])
  git(['commit', '-q', '-m', 'seed'])
  if (changed) {
    const full = path.join(dir, changed)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, 'export const x = 1\n')
  }
  return dir
}

function runGate(dir, stopHookActive = false) {
  return spawnSync('node', [GATE], {
    input: JSON.stringify({ cwd: dir, stop_hook_active: stopHookActive }),
    encoding: 'utf8'
  })
}

test('integration: reatom project with changed TypeScript blocks', () => {
  const dir = makeRepo()
  const out = JSON.parse(runGate(dir).stdout.trim())
  assert.equal(out.decision, 'block')
  assert.match(out.reason, /audit-lifecycle/)
  assert.match(out.reason, /src[\\/]model\.ts/)
})

test('integration: non-reatom project allows silently', () => {
  const dir = makeRepo({ reatom: false })
  assert.equal(runGate(dir).stdout.trim(), '')
})

test('integration: reatom project with no TypeScript change allows silently', () => {
  const dir = makeRepo({ changed: null })
  assert.equal(runGate(dir).stdout.trim(), '')
})

test('integration: stop_hook_active allows silently', () => {
  const dir = makeRepo()
  assert.equal(runGate(dir, true).stdout.trim(), '')
})

test('integration: an unchanged second run allows via the marker', () => {
  const dir = makeRepo()
  assert.equal(JSON.parse(runGate(dir).stdout.trim()).decision, 'block')
  assert.equal(runGate(dir).stdout.trim(), '', 'same state must not re-audit')
})

test('integration: a further TypeScript change re-blocks', () => {
  const dir = makeRepo()
  runGate(dir)
  fs.writeFileSync(path.join(dir, 'src', 'other.tsx'), 'export const y = 2\n')
  assert.equal(JSON.parse(runGate(dir).stdout.trim()).decision, 'block')
})

test('integration: committed work on a branch is still audited', () => {
  const dir = makeRepo({ changed: null })
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  git(['checkout', '-q', '-b', 'feature'])
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'src', 'committed.ts'), 'export const z = 3\n')
  git(['add', '.'])
  git(['commit', '-q', '-m', 'feature work'])
  const out = JSON.parse(runGate(dir).stdout.trim())
  assert.equal(out.decision, 'block')
  assert.match(out.reason, /committed\.ts/)
})

test('integration: a non-git directory allows silently', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reatom-nogit-'))
  fs.writeFileSync(path.join(dir, 'package.json'), '{"dependencies":{"@reatom/core":"1001.0.0"}}')
  assert.equal(runGate(dir).stdout.trim(), '')
})
