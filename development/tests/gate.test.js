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

test('integration: with no origin/HEAD and no conventional name, the commit graph picks the base', () => {
  const dir = makeRepo({ changed: null, branch: 'release' })
  commitOnFeatureBranch(dir)
  const out = JSON.parse(runGate(dir).stdout.trim())
  assert.equal(out.decision, 'block')
  assert.match(out.reason, /committed\.ts/)
})

test('integration: the heuristic does not choose the current branch own remote mirror', () => {
  const dir = makeRepo({ changed: null, branch: 'release' })
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  commitOnFeatureBranch(dir)
  // A pushed, up-to-date branch: origin/feature sits on the same commit as
  // HEAD, so its merge-base is HEAD itself — the newest possible, and it would
  // win the heuristic and diff the branch against itself, hiding every commit.
  const sha = git(['rev-parse', 'HEAD']).stdout.trim()
  git(['update-ref', 'refs/remotes/origin/feature', sha])
  const out = JSON.parse(runGate(dir).stdout.trim())
  assert.equal(out.decision, 'block', 'origin/feature must not be treated as the base')
  assert.match(out.reason, /committed\.ts/)
})

const BASE_PIN = 'reatom-base-branch'

test('integration: detection pins the base branch into .git', () => {
  const dir = makeRepo({ changed: null, branch: 'master' })
  commitOnFeatureBranch(dir)
  runGate(dir)
  const pinned = fs.readFileSync(path.join(dir, '.git', BASE_PIN), 'utf8').trim()
  assert.equal(pinned, 'refs/heads/master auto')
})

test('integration: a "none" pin narrows the audit to the working tree', () => {
  const dir = makeRepo({ changed: null })
  commitOnFeatureBranch(dir)
  fs.writeFileSync(path.join(dir, '.git', BASE_PIN), 'none\n')
  assert.equal(
    runGate(dir).stdout.trim(),
    '',
    'a none pin drops committed branch work from scope'
  )
})

test('integration: a hand-written pin is used instead of detection', () => {
  const dir = makeRepo({ changed: null, branch: 'master' })
  commitOnFeatureBranch(dir)
  // Pin the feature branch itself: merge-base(HEAD, feature) is HEAD, so the
  // committed diff is empty and nothing reaches an auditor. A detected base
  // would have found refs/heads/master and blocked.
  fs.writeFileSync(path.join(dir, '.git', BASE_PIN), 'refs/heads/feature\n')
  assert.equal(runGate(dir).stdout.trim(), '', 'the pin overrides detection')
})

test('integration: a pin that no longer resolves falls back to fresh detection', () => {
  const dir = makeRepo({ changed: null, branch: 'master' })
  commitOnFeatureBranch(dir)
  fs.writeFileSync(path.join(dir, '.git', BASE_PIN), 'refs/heads/deleted-branch\n')
  const out = JSON.parse(runGate(dir).stdout.trim())
  assert.equal(out.decision, 'block')
  assert.match(out.reason, /committed\.ts/)
  assert.equal(
    fs.readFileSync(path.join(dir, '.git', BASE_PIN), 'utf8').trim(),
    'refs/heads/master auto',
    'the stale pin is replaced with what detection found'
  )
})

test('integration: a guessed base branch warns once and names the pin file', () => {
  const dir = makeRepo({ changed: null, branch: 'release' })
  commitOnFeatureBranch(dir)
  const first = JSON.parse(runGate(dir).stdout.trim())
  assert.equal(first.decision, 'block', 'the warning rides along with the audit block')
  assert.match(first.systemMessage, /guessed the base branch as "refs\/heads\/release"/)
  assert.match(first.systemMessage, /reatom-base-branch/)

  // A further change keeps the gate blocking, so a repeated warning would be
  // visible rather than hidden behind an allow.
  fs.writeFileSync(path.join(dir, 'src', 'other.ts'), 'export const q = setInterval(() => {}, 1000)\n')
  const second = JSON.parse(runGate(dir).stdout.trim())
  assert.equal(second.decision, 'block')
  assert.ok(!second.systemMessage, 'the pin silences the repeat warning')
})

test('integration: an undetectable base branch warns and still allows', () => {
  // One branch, no remote, nothing else to compare HEAD against.
  const dir = makeRepo({ changed: null, branch: 'release' })
  const out = JSON.parse(runGate(dir).stdout.trim())
  assert.ok(!out.decision, 'there is nothing to audit')
  assert.match(out.systemMessage, /could not identify a base branch/)
  assert.match(out.systemMessage, /reatom-base-branch/)
})

test('integration: a base branch found by name warns about nothing', () => {
  const dir = makeRepo({ changed: null, branch: 'master' })
  commitOnFeatureBranch(dir)
  const out = JSON.parse(runGate(dir).stdout.trim())
  assert.equal(out.decision, 'block')
  assert.ok(!out.systemMessage, 'a conventional name is not a guess')
})

test('integration: an auto "none" pin self-heals once origin/HEAD appears', () => {
  const dir = makeRepo({ changed: null, branch: 'release' })
  // First run: one branch, nothing to compare HEAD against at all.
  const first = JSON.parse(runGate(dir).stdout.trim())
  assert.ok(!first.decision, 'nothing to audit yet')
  assert.match(first.systemMessage, /could not identify a base branch/)

  commitOnFeatureBranch(dir)
  // Still nothing origin/HEAD or a conventional name can find — the auto
  // "none" pin still applies, silently (no repeat warning). With base.ref
  // null, the committed work on `feature` stays out of scope too, so there
  // is nothing to block on and nothing to warn about: main() writes no
  // stdout at all in that case (same as any other fully-silent run).
  const secondRaw = runGate(dir).stdout.trim()
  const second = secondRaw ? JSON.parse(secondRaw) : {}
  assert.ok(!second.decision, 'the auto pin still applies until something confidently resolves')
  assert.ok(!second.systemMessage, 'no repeat warning on an unchanged auto pin')

  // A base branch shows up later — origin/HEAD gets configured.
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  const sha = git(['rev-parse', 'refs/heads/release']).stdout.trim()
  git(['update-ref', 'refs/remotes/origin/release', sha])
  git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/release'])

  const third = JSON.parse(runGate(dir).stdout.trim())
  assert.equal(third.decision, 'block', 'the auto pin self-healed once origin/HEAD appeared')
  assert.match(third.reason, /committed\.ts/)
  assert.ok(!third.systemMessage, 'the self-heal itself is silent, not a fresh warning')
})

test('integration: a manually-written "none" pin stays sticky even after origin/HEAD appears', () => {
  const dir = makeRepo({ changed: null, branch: 'release' })
  commitOnFeatureBranch(dir)
  fs.writeFileSync(path.join(dir, '.git', BASE_PIN), 'none\n') // no "auto" suffix: a deliberate opt-out
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  const sha = git(['rev-parse', 'refs/heads/release']).stdout.trim()
  git(['update-ref', 'refs/remotes/origin/release', sha])
  git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/release'])
  assert.equal(
    runGate(dir).stdout.trim(),
    '',
    'a manual none is an explicit opt-out and must not self-heal'
  )
})

const { readIgnorePatterns } = require('../../hooks/gate-logic')

test('readIgnorePatterns keeps patterns and drops comments and blanks', () => {
  const raw = [
    '# fixtures the scanner reads as data',
    '',
    'src/fixtures/',
    '  *.gen.ts  ',
    '   ',
    'tools/lexer.ts'
  ].join('\n')
  assert.deepEqual(readIgnorePatterns(raw), ['src/fixtures/', '*.gen.ts', 'tools/lexer.ts'])
})

test('readIgnorePatterns treats a missing file as no patterns', () => {
  assert.deepEqual(readIgnorePatterns(null), [])
  assert.deepEqual(readIgnorePatterns(undefined), [])
  assert.deepEqual(readIgnorePatterns(''), [])
})

test('readIgnorePatterns splits CRLF input cleanly', () => {
  assert.deepEqual(readIgnorePatterns('a.ts\r\nb.ts\r\n'), ['a.ts', 'b.ts'])
})

const { filterIgnored } = require('../../hooks/gate-logic')

test('filterIgnored with no patterns returns the list untouched', () => {
  const files = ['src/a.ts', 'src/b.tsx']
  assert.deepEqual(filterIgnored(files, []), files)
})

test('a pattern with a slash anchors to the project root', () => {
  const files = ['src/gen/api.ts', 'apps/web/src/gen/api.ts']
  assert.deepEqual(filterIgnored(files, ['src/gen/api.ts']), ['apps/web/src/gen/api.ts'])
})

test('a leading slash anchors the same way', () => {
  const files = ['src/gen/api.ts', 'apps/web/src/gen/api.ts']
  assert.deepEqual(filterIgnored(files, ['/src/gen/api.ts']), ['apps/web/src/gen/api.ts'])
})

test('a slashless pattern matches any path segment at any depth', () => {
  const files = ['src/fixtures/case.ts', 'fixtures/case.ts', 'src/real/model.ts', 'src/fixtures.ts']
  assert.deepEqual(filterIgnored(files, ['fixtures']), ['src/real/model.ts', 'src/fixtures.ts'])
})

test('a star does not cross a slash', () => {
  const files = ['src/a.gen.ts', 'src/deep/b.gen.ts']
  assert.deepEqual(filterIgnored(files, ['src/*.ts']), ['src/deep/b.gen.ts'])
})

test('a double star crosses directories', () => {
  const files = ['src/a.test.ts', 'src/deep/er/b.test.ts', 'src/model.ts']
  assert.deepEqual(filterIgnored(files, ['src/**/*.test.ts']), ['src/model.ts'])
})

test('a question mark matches exactly one character within a segment', () => {
  const files = ['src/a1.ts', 'src/a12.ts']
  assert.deepEqual(filterIgnored(files, ['src/a?.ts']), ['src/a12.ts'])
})

test('a trailing slash ignores everything under the directory, at any depth', () => {
  const files = ['tools/scanner/lexer.ts', 'tools.ts', 'src/tools/x.ts']
  assert.deepEqual(filterIgnored(files, ['tools/']), ['tools.ts'])
})

test('a dot in a pattern is literal, not a regex wildcard', () => {
  const files = ['src/api.gen.ts', 'src/apixgenxts.ts']
  assert.deepEqual(filterIgnored(files, ['*.gen.ts']), ['src/apixgenxts.ts'])
})

test('integration: .reatom-gate-ignore drops a matching file from the gate', () => {
  const dir = makeRepo()
  fs.writeFileSync(
    path.join(dir, '.reatom-gate-ignore'),
    '# scanner fixtures, not audit surface\nsrc/model.ts\n'
  )
  assert.equal(runGate(dir).stdout.trim(), '', 'the ignored file must not block the gate')
})

test('integration: a non-matching ignore file leaves the gate blocking', () => {
  const dir = makeRepo()
  fs.writeFileSync(path.join(dir, '.reatom-gate-ignore'), 'tools/\n*.gen.ts\n')
  const out = JSON.parse(runGate(dir).stdout.trim())
  assert.equal(out.decision, 'block')
  assert.match(out.reason, /src[\\/]model\.ts/)
})

const ROUTE = path.join(__dirname, '..', '..', 'hooks', 'route.js')

test('route.js ignores .reatom-gate-ignore in cwd — /reatom-audit must reach ignored paths', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reatom-route-'))
  fs.mkdirSync(path.join(dir, 'src'))
  fs.writeFileSync(path.join(dir, 'src', 'model.ts'), 'export const x = setInterval(() => {}, 1000)\n')
  fs.writeFileSync(path.join(dir, '.reatom-gate-ignore'), 'src/model.ts\n')
  const result = spawnSync('node', [ROUTE, 'src/model.ts'], { cwd: dir, encoding: 'utf8' })
  assert.match(result.stdout, /audit-lifecycle/)
  assert.match(result.stdout, /src\/model\.ts/)
  assert.ok(
    !result.stdout.includes('No auditable TypeScript'),
    'the manual router must not apply the gate ignore file'
  )
})

test('the block reason opens with session-context triage before the dispatch orders', () => {
  const { reason } = gateDecision(base)
  const triage = reason.indexOf('TRIAGE FIRST')
  const orders = reason.indexOf('Dispatch these auditors')
  assert.ok(triage !== -1, 'the triage protocol is present')
  assert.ok(orders !== -1, 'the dispatch orders are still present')
  assert.ok(triage < orders, 'triage comes before the dispatch orders')
  assert.match(reason, /do not open or inspect the files/)
  assert.match(reason, /did this session change it/)
  assert.match(reason, /unsure, audit/)
  assert.match(reason, /\/reatom-audit/)
  assert.match(reason, /\.reatom-gate-ignore/)
  assert.match(reason, /report the skip to the operator/)
})
