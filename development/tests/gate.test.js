const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { auditableFiles, gateDecision, DOMAINS } = require('../../hooks/gate-logic')

const GATE = path.join(__dirname, '..', '..', 'hooks', 'reatom-gate.js')

const base = {
  stopHookActive: false,
  isGitRepo: true,
  isReatomProject: true,
  auditableFiles: ['src/model.ts'],
  plan: {
    assignments: { state: ['src/model.ts'], async: ['src/model.ts'] },
    notDispatched: ['lifecycle', 'routing-forms', 'react'],
    fullyCached: [],
    skipped: 7,
    nextCache: { 'src/model.ts\u0000state': 'h' }
  }
}

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

test('gateDecision blocks only when there is work to dispatch', () => {
  assert.equal(gateDecision(base).block, true)
  assert.equal(gateDecision({ ...base, stopHookActive: true }).block, false)
  assert.equal(gateDecision({ ...base, isGitRepo: false }).block, false)
  assert.equal(gateDecision({ ...base, isReatomProject: false }).block, false)
  assert.equal(gateDecision({ ...base, auditableFiles: [] }).block, false)
  assert.equal(
    gateDecision({ ...base, plan: { ...base.plan, assignments: {} } }).block,
    false,
    'everything already audited'
  )
})

test('a fully cached run still records the pruned cache', () => {
  const decision = gateDecision({ ...base, plan: { ...base.plan, assignments: {} } })
  assert.equal(decision.writeCache, true, 'pruning must survive an allow')
})

test('the block reason lists files under each dispatched auditor only', () => {
  const { reason } = gateDecision(base)
  assert.match(reason, /audit-state \(references\/rules-state\.md\)/)
  assert.match(reason, /audit-async \(references\/rules-async\.md\)/)
  assert.ok(!/^audit-react/m.test(reason), 'a domain with no work is not dispatched')
  assert.match(reason, /Not dispatched — no matching code: audit-lifecycle, audit-routing-forms, audit-react/)
  assert.match(reason, /Skipped — unchanged since last audit: 7 pairs/)
  assert.match(reason, /dismiss/i)
})

test('the block reason names fully cached domains on their own line, not as "no matching code"', () => {
  const ctx = {
    ...base,
    plan: {
      assignments: { async: ['src/model.ts'] },
      notDispatched: ['react'],
      fullyCached: ['state', 'lifecycle', 'routing-forms'],
      skipped: 7,
      nextCache: {}
    }
  }
  const { reason } = gateDecision(ctx)
  assert.match(
    reason,
    /Fully cached — routed but already audited: audit-state, audit-lifecycle, audit-routing-forms/
  )
  assert.match(reason, /Not dispatched — no matching code: audit-react/)
  assert.ok(
    !/no matching code: audit-react, audit-state/.test(reason),
    'a fully cached domain must not be folded into the not-dispatched line'
  )
})

test('the block reason omits the fully-cached line when there is nothing to name', () => {
  const { reason } = gateDecision(base)
  assert.ok(!reason.includes('Fully cached'), 'base plan has no fully cached domains')
})

test('the block reason uses the singular for exactly one skipped pair', () => {
  const ctx = { ...base, plan: { ...base.plan, skipped: 1 } }
  const { reason } = gateDecision(ctx)
  assert.match(reason, /Skipped — unchanged since last audit: 1 pair$/m)
})

test('the block reason truncates a long file list within one auditor', () => {
  const many = Array.from({ length: 45 }, (_, i) => `src/f${i}.ts`)
  const ctx = {
    ...base,
    plan: {
      assignments: { state: many },
      notDispatched: ['lifecycle', 'routing-forms', 'react'],
      fullyCached: ['async'],
      skipped: 7,
      nextCache: {}
    }
  }
  const { reason } = gateDecision(ctx)
  assert.match(reason, /audit-state \(references\/rules-state\.md\)/)
  assert.match(reason, /src\/f39\.ts/, 'the last file within the cap is listed')
  assert.ok(!reason.includes('src/f40.ts'), 'files past the cap are not listed individually')
  assert.match(reason, /…and 5 more — audit them too/)
})

function makeRepo({ reatom = true, changed = 'src/model.ts', branch = 'main' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reatom-gate-'))
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  git(['init', '-q', '-b', branch])
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
    fs.writeFileSync(full, 'export const x = setInterval(() => {}, 1000)\n')
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

test('integration: an unchanged second run allows via the cache', () => {
  const dir = makeRepo()
  assert.equal(JSON.parse(runGate(dir).stdout.trim()).decision, 'block')
  assert.equal(runGate(dir).stdout.trim(), '', 'same state must not re-audit')
})

test('integration: editing contents without moving HEAD re-blocks', () => {
  const dir = makeRepo()
  assert.equal(JSON.parse(runGate(dir).stdout.trim()).decision, 'block')
  fs.writeFileSync(path.join(dir, 'src', 'model.ts'), 'export const x = atom(2, "x")\n')
  const out = JSON.parse(runGate(dir).stdout.trim())
  assert.equal(out.decision, 'block', 'a content edit must not pass unaudited')
})

test('integration: a docs-only commit does not re-audit unchanged TypeScript', () => {
  const dir = makeRepo()
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  assert.equal(JSON.parse(runGate(dir).stdout.trim()).decision, 'block')
  fs.writeFileSync(path.join(dir, 'notes.md'), '# notes\n')
  // Stage only the markdown. `git add .` would also commit src/model.ts, which
  // drops it out of scope entirely and would make this test pass for the wrong
  // reason — the file must stay in scope and be skipped by the cache.
  git(['add', 'notes.md'])
  git(['commit', '-q', '-m', 'docs'])
  assert.equal(runGate(dir).stdout.trim(), '', 'HEAD moved but no TypeScript changed')
})

test('integration: a further TypeScript change re-blocks', () => {
  const dir = makeRepo()
  runGate(dir)
  fs.writeFileSync(path.join(dir, 'src', 'other.tsx'), 'export const y = setInterval(() => {}, 1000)\n')
  assert.equal(JSON.parse(runGate(dir).stdout.trim()).decision, 'block')
})

test('integration: committed work on a branch is still audited', () => {
  const dir = makeRepo({ changed: null })
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  git(['checkout', '-q', '-b', 'feature'])
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'src', 'committed.ts'), 'export const z = setInterval(() => {}, 1000)\n')
  git(['add', '.'])
  git(['commit', '-q', '-m', 'feature work'])
  const out = JSON.parse(runGate(dir).stdout.trim())
  assert.equal(out.decision, 'block')
  assert.match(out.reason, /committed\.ts/)
})

test('integration: a deleted TypeScript file is not dispatched to any auditor', () => {
  const dir = makeRepo({ changed: null })
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'src', 'gone.ts'), 'export const x = setInterval(() => {}, 1000)\n')
  git(['add', '.'])
  git(['commit', '-q', '-m', 'add gone.ts'])
  fs.rmSync(path.join(dir, 'src', 'gone.ts'))
  // A surviving change proves the gate still runs and still blocks — the
  // assertion is that the deleted path specifically never reaches an auditor,
  // not that the gate goes quiet altogether.
  fs.writeFileSync(path.join(dir, 'src', 'model.ts'), 'export const y = setInterval(() => {}, 1000)\n')
  const out = JSON.parse(runGate(dir).stdout.trim())
  assert.equal(out.decision, 'block', 'the surviving file still needs an audit')
  assert.ok(!out.reason.includes('gone.ts'), 'a deleted file must not fan out to every auditor')
})

test('integration: a non-git directory allows silently', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reatom-nogit-'))
  fs.writeFileSync(path.join(dir, 'package.json'), '{"dependencies":{"@reatom/core":"1001.0.0"}}')
  assert.equal(runGate(dir).stdout.trim(), '')
})

// REFERENCES in reatom-gate.js is resolved from the gate file's own location
// (__dirname), not from the target repo's cwd. So to prove the gate fails
// open when the rule registry is unreadable, without touching the checked-out
// skills/reatom/references/rules.md, we run a scratch copy of the plugin —
// hooks/ plus the reference slices — with rules.md withheld from the copy.
function makeGateWithoutRegistry() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reatom-gate-noregistry-'))
  const hooksSrc = path.join(__dirname, '..', '..', 'hooks')
  const refsSrc = path.join(__dirname, '..', '..', 'skills', 'reatom', 'references')
  const hooksDst = path.join(dir, 'hooks')
  const refsDst = path.join(dir, 'skills', 'reatom', 'references')
  fs.mkdirSync(hooksDst, { recursive: true })
  fs.mkdirSync(refsDst, { recursive: true })
  for (const name of fs.readdirSync(hooksSrc)) {
    fs.copyFileSync(path.join(hooksSrc, name), path.join(hooksDst, name))
  }
  for (const name of fs.readdirSync(refsSrc)) {
    if (name === 'rules.md') continue // the one file this scratch copy withholds
    const src = path.join(refsSrc, name)
    if (fs.statSync(src).isDirectory()) continue
    fs.copyFileSync(src, path.join(refsDst, name))
  }
  return path.join(hooksDst, 'reatom-gate.js')
}

test('integration: an unreadable rule registry allows silently instead of crashing', () => {
  const dir = makeRepo()
  const gate = makeGateWithoutRegistry()
  const result = spawnSync('node', [gate], {
    input: JSON.stringify({ cwd: dir, stop_hook_active: false }),
    encoding: 'utf8'
  })
  assert.equal(result.status, 0, 'a missing registry must not crash the process')
  assert.equal(result.stdout.trim(), '', 'a missing registry must allow, not block')
  assert.equal(result.stderr.trim(), '', 'no stack trace should reach stderr either')
})

const { buildTriggers, routeFile } = require('../../hooks/gate-logic')

const RULES = fs.readFileSync(
  path.join(__dirname, '..', '..', 'skills', 'reatom', 'references', 'rules.md'),
  'utf8'
)
const TRIGGERS = buildTriggers(RULES)

test('buildTriggers unions each domain rules tokens', () => {
  assert.ok(TRIGGERS.async.includes('useEffect'), 'async inherits RTM-A01')
  assert.ok(TRIGGERS.lifecycle.includes('setInterval'), 'lifecycle inherits RTM-L01')
  assert.ok(!TRIGGERS.lifecycle.includes('useEffect'), 'domains do not leak into each other')
  for (const domain of ['async', 'state', 'lifecycle', 'routing-forms', 'react']) {
    assert.ok(TRIGGERS[domain].length > 0, `${domain} has triggers`)
  }
})

test('an inert file routes nowhere', () => {
  const contents = 'import { execSync } from "node:child_process"\nexport const run = () => execSync("tsc")\n'
  assert.deepEqual(routeFile('scripts/bench.ts', contents, TRIGGERS), [])
})

test('a file with surface but no trigger falls back to every auditor', () => {
  const contents = 'import { useMemo } from "react"\nexport const useThing = () => useMemo(() => 1, [])\n'
  assert.deepEqual(routeFile('src/x.ts', contents, TRIGGERS), [
    'async', 'state', 'lifecycle', 'routing-forms', 'react'
  ])
})

test('a useEffect fetch with no reatom import still routes to async', () => {
  const contents = 'useEffect(() => { fetch(url).then(setData) }, [])\n'
  const domains = routeFile('src/Widget.tsx', contents, TRIGGERS)
  assert.ok(domains.includes('async'), 'reinvention rules fire on code that avoided the library')
})

test('every calibration fixture routes to the domains owning its expected rules', () => {
  const FIXTURES = path.join(__dirname, '..', 'fixtures')
  const expected = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'expected.json'), 'utf8'))
  const domainOf = {}
  for (const block of RULES.split(/^### /m).slice(1)) {
    domainOf[block.slice(0, block.indexOf(' '))] = (block.match(/^- domain: (.+)$/m) || [])[1]
  }

  const missed = []
  for (const [file, ids] of Object.entries(expected.violations)) {
    const contents = fs.readFileSync(path.join(FIXTURES, 'violations', file), 'utf8')
    const routed = routeFile(file, contents, TRIGGERS)
    for (const id of ids) {
      if (!routed.includes(domainOf[id])) missed.push(`${file} misses ${domainOf[id]} for ${id}`)
    }
  }
  assert.deepEqual(missed, [], `routing drops known violations: ${missed.join(' | ')}`)
})

const { pairKey, pairHash, parseCache, planAudit } = require('../../hooks/gate-logic')

const SLICES = { async: 'A', state: 'S', lifecycle: 'L', 'routing-forms': 'R', react: 'C' }
const readSlice = (domain) => SLICES[domain]

function plan(files, contents, cache = {}) {
  return planAudit({ files, readFile: (f) => contents[f], readSlice, cache, triggers: TRIGGERS })
}

test('pairKey separates file and domain with a real NUL, not a space or colon', () => {
  const NUL = String.fromCharCode(0)
  const key = pairKey('a', 'b')
  assert.equal(key.charCodeAt(1), 0, 'the separator byte is NUL')
  assert.equal(key, 'a' + NUL + 'b')
  // A path containing a literal space or colon must not collide with a
  // differently-split pair — that would read as "already audited".
  assert.notEqual(pairKey('a b', 'c'), pairKey('a', 'b c'))
})

test('pairHash changes when file contents or slice contents change', () => {
  const base = pairHash('file contents', 'slice contents')
  assert.notEqual(pairHash('other contents', 'slice contents'), base)
  assert.notEqual(pairHash('file contents', 'other slice'), base)
})

test('parseCache treats anything that is not a plain object as empty', () => {
  assert.deepEqual(parseCache('{"a":"b"}'), { a: 'b' })
  assert.deepEqual(parseCache('9d8c7b6a'), {}, 'legacy hex marker')
  assert.deepEqual(parseCache('1234567890'), {}, 'an all-digit hash parses as a number')
  assert.deepEqual(parseCache('[1,2]'), {}, 'arrays are not caches')
  assert.deepEqual(parseCache(null), {})
})

test('planAudit assigns a file only to the domains that can fire on it', () => {
  const contents = { 'src/poll.ts': fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', 'violations', 'polling-timer.ts'), 'utf8') }
  const { assignments, notDispatched } = plan(['src/poll.ts'], contents)
  assert.ok(assignments.lifecycle.includes('src/poll.ts'))
  assert.ok(notDispatched.includes('routing-forms'), 'a domain with no work is not dispatched')
  assert.ok(!('routing-forms' in assignments), 'empty domains are absent, not empty arrays')
})

test('a domain that is fully cached is distinguished from a domain never routed to', () => {
  const contents = { 'src/poll.ts': fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', 'violations', 'polling-timer.ts'), 'utf8') }
  const first = plan(['src/poll.ts'], contents)
  assert.ok(first.assignments.lifecycle.includes('src/poll.ts'))
  assert.ok(first.notDispatched.includes('routing-forms'), 'never routed to this file')
  assert.deepEqual(first.fullyCached, [], 'nothing is cached on the first run')

  const second = plan(['src/poll.ts'], contents, first.nextCache)
  assert.deepEqual(second.assignments, {}, 'nothing new to audit')
  assert.ok(
    second.fullyCached.includes('lifecycle'),
    'lifecycle had files routed to it, all of which were already audited'
  )
  assert.ok(
    !second.notDispatched.includes('lifecycle'),
    'a fully cached domain must not be reported as having no matching code'
  )
  assert.ok(
    second.notDispatched.includes('routing-forms'),
    'routing-forms was never routed to this file and stays not-dispatched'
  )
  assert.ok(
    !second.fullyCached.includes('routing-forms'),
    'a domain never routed to is not "fully cached" either'
  )
})

test('an unchanged pair is skipped on the second plan', () => {
  const contents = { 'src/a.ts': 'export const x = atom(1, "x")\n' }
  const first = plan(['src/a.ts'], contents)
  assert.ok(Object.keys(first.assignments).length > 0)
  const second = plan(['src/a.ts'], contents, first.nextCache)
  assert.deepEqual(second.assignments, {}, 'nothing to re-audit')
  assert.ok(second.skipped > 0, 'and the skip is counted')
})

test('changed contents re-audit even when the file list is identical', () => {
  const before = { 'src/a.ts': 'export const x = atom(1, "x")\n' }
  const after = { 'src/a.ts': 'export const x = atom(2, "x")\n' }
  const first = plan(['src/a.ts'], before)
  const second = plan(['src/a.ts'], after, first.nextCache)
  assert.ok(Object.keys(second.assignments).length > 0, 'content edits are not invisible')
})

test('editing one domain slice invalidates that domain and no other', () => {
  const contents = { 'src/a.ts': 'const t = setInterval(f, 1)\nconst x = atom(1, "x")\n' }
  const first = plan(['src/a.ts'], contents)
  assert.ok(first.assignments.state && first.assignments.lifecycle)
  const edited = { ...SLICES, lifecycle: 'L2' }
  const second = planAudit({
    files: ['src/a.ts'],
    readFile: (f) => contents[f],
    readSlice: (d) => edited[d],
    cache: first.nextCache,
    triggers: TRIGGERS
  })
  assert.deepEqual(Object.keys(second.assignments), ['lifecycle'])
})

test('the cache is pruned to the current file set', () => {
  const contents = { 'src/a.ts': 'atom(1, "a")\n', 'src/b.ts': 'atom(2, "b")\n' }
  const first = plan(['src/a.ts', 'src/b.ts'], contents)
  const second = plan(['src/a.ts'], contents, first.nextCache)
  const stale = Object.keys(second.nextCache).filter((k) => k.startsWith('src/b.ts'))
  assert.deepEqual(stale, [], 'pairs for files no longer in scope are dropped')
})

test('an unreadable file fails open into every domain', () => {
  const { assignments } = planAudit({
    files: ['src/gone.ts'],
    readFile: () => { throw new Error('ENOENT') },
    readSlice,
    cache: {},
    triggers: TRIGGERS
  })
  assert.deepEqual(Object.keys(assignments).sort(), [...DOMAINS].sort())
})

// Commits a TypeScript file on a fresh branch off the repo's default branch.
// The file is committed, not left dirty, so it can only reach an auditor
// through the merge-base diff — which is exactly what base detection feeds.
function commitOnFeatureBranch(dir, file = 'src/committed.ts') {
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  git(['checkout', '-q', '-b', 'feature'])
  const full = path.join(dir, file)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, 'export const z = setInterval(() => {}, 1000)\n')
  git(['add', '.'])
  git(['commit', '-q', '-m', 'feature work'])
}

test('integration: committed work is audited when the base branch is master, not main', () => {
  const dir = makeRepo({ changed: null, branch: 'master' })
  commitOnFeatureBranch(dir)
  const out = JSON.parse(runGate(dir).stdout.trim())
  assert.equal(out.decision, 'block')
  assert.match(out.reason, /committed\.ts/)
})

test('integration: origin/HEAD names the base branch when no conventional name exists', () => {
  const dir = makeRepo({ changed: null, branch: 'release' })
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  // Fake what `clone` leaves behind, without a network: a remote-tracking ref
  // at the default branch's tip, plus origin/HEAD pointing symbolically at it.
  const sha = git(['rev-parse', 'HEAD']).stdout.trim()
  git(['update-ref', 'refs/remotes/origin/release', sha])
  git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/release'])
  commitOnFeatureBranch(dir)
  const out = JSON.parse(runGate(dir).stdout.trim())
  assert.equal(out.decision, 'block')
  assert.match(out.reason, /committed\.ts/)
})
