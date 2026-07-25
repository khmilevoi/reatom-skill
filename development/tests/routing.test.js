const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const {
  auditableFiles,
  formatOrders,
  DOMAINS,
  buildTriggers,
  routeFile,
  pairKey,
  pairHash,
  parseCache,
  planAudit,
  readIgnorePatterns,
  filterIgnored
} = require('../../scripts/routing')

const ROUTE = path.join(__dirname, '..', '..', 'scripts', 'route.js')
const INIT = path.join(__dirname, '..', '..', 'scripts', 'init-claude-md.js')

const plan = {
  assignments: { state: ['src/model.ts'], async: ['src/model.ts'] },
  notDispatched: ['lifecycle', 'routing-forms', 'react'],
  fullyCached: [],
  skipped: 7,
  nextCache: {}
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

test('the orders list files under each dispatched auditor only', () => {
  const out = formatOrders(plan)
  assert.match(out, /audit-state \(references\/rules-state\.md\)/)
  assert.match(out, /audit-async \(references\/rules-async\.md\)/)
  assert.ok(!/^audit-react/m.test(out), 'a domain with no work is not dispatched')
  assert.match(out, /Not dispatched — no matching code: audit-lifecycle, audit-routing-forms, audit-react/)
  assert.match(out, /Skipped — unchanged since last audit: 7 pairs/)
  assert.match(out, /dismiss/i)
})

test('the orders open with the scope line when one is given', () => {
  const out = formatOrders(plan, 'Scope: two files.')
  assert.ok(out.startsWith('Scope: two files.\n\n'), 'the scope leads, then a blank line')
})

test('the orders name fully cached domains on their own line, not as "no matching code"', () => {
  const out = formatOrders({
    assignments: { async: ['src/model.ts'] },
    notDispatched: ['react'],
    fullyCached: ['state', 'lifecycle', 'routing-forms'],
    skipped: 7,
    nextCache: {}
  })
  assert.match(out, /Fully cached — routed but already audited: audit-state, audit-lifecycle, audit-routing-forms/)
  assert.match(out, /Not dispatched — no matching code: audit-react/)
  assert.ok(
    !/no matching code: audit-react, audit-state/.test(out),
    'a fully cached domain must not be folded into the not-dispatched line'
  )
})

test('the orders omit the fully-cached line when there is nothing to name', () => {
  assert.ok(!formatOrders(plan).includes('Fully cached'), 'the base plan has no fully cached domains')
})

test('the orders use the singular for exactly one skipped pair', () => {
  assert.match(formatOrders({ ...plan, skipped: 1 }), /Skipped — unchanged since last audit: 1 pair$/m)
})

test('the orders never truncate a long file list', () => {
  const many = Array.from({ length: 45 }, (_, i) => `src/f${i}.ts`)
  const out = formatOrders({
    assignments: { state: many },
    notDispatched: ['lifecycle', 'routing-forms', 'react'],
    fullyCached: ['async'],
    skipped: 0,
    nextCache: {}
  })
  assert.match(out, /src\/f44\.ts/, 'the last file is listed, not elided')
  assert.ok(!out.includes('more — audit them too'), 'no overflow marker survives')
  for (const file of many) assert.ok(out.includes(file), `${file} is listed`)
})

test('the orders say so plainly when everything routed is already audited', () => {
  const out = formatOrders({
    assignments: {},
    notDispatched: ['react'],
    fullyCached: ['async', 'state', 'lifecycle', 'routing-forms'],
    skipped: 12,
    nextCache: {}
  })
  assert.match(out, /Nothing to dispatch/)
  assert.ok(!out.includes('Dispatch these auditors'), 'no fan-out instruction without a fan-out')
  assert.ok(!out.includes('Audit: N findings'), 'and no report instruction either')
})

function makeRepo({ changed = 'src/model.ts', branch = 'main' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reatom-route-'))
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  git(['init', '-q', '-b', branch])
  git(['config', 'user.email', 't@t'])
  git(['config', 'user.name', 't'])
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'app', dependencies: { '@reatom/core': '1001.0.0' } }, null, 2)
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

function runRoute(dir, args = []) {
  return spawnSync('node', [ROUTE, ...args], { cwd: dir, encoding: 'utf8' })
}

test('integration: changed TypeScript is routed to its auditors', () => {
  const out = runRoute(makeRepo())
  assert.equal(out.status, 0, out.stderr)
  assert.match(out.stdout, /audit-lifecycle/)
  assert.match(out.stdout, /src[\\/]model\.ts/)
})

test('integration: a repo with no TypeScript change has nothing in scope', () => {
  assert.match(runRoute(makeRepo({ changed: null })).stdout, /No auditable TypeScript in scope/)
})

test('integration: an unchanged second run dispatches nothing', () => {
  const dir = makeRepo()
  assert.match(runRoute(dir).stdout, /audit-lifecycle/)
  assert.match(runRoute(dir).stdout, /Nothing to dispatch/, 'the cache carries across runs')
})

test('integration: editing contents without moving HEAD re-dispatches', () => {
  const dir = makeRepo()
  runRoute(dir)
  fs.writeFileSync(path.join(dir, 'src', 'model.ts'), 'export const x = atom(2, "x")\n')
  assert.match(runRoute(dir).stdout, /audit-state/, 'a content edit must not pass unaudited')
})

test('integration: a docs-only commit does not re-audit unchanged TypeScript', () => {
  const dir = makeRepo()
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  runRoute(dir)
  fs.writeFileSync(path.join(dir, 'notes.md'), '# notes\n')
  // Stage only the markdown. `git add .` would also commit src/model.ts, which
  // drops it out of scope entirely and would make this test pass for the wrong
  // reason — the file must stay in scope and be skipped by the cache.
  git(['add', 'notes.md'])
  git(['commit', '-q', '-m', 'docs'])
  assert.match(runRoute(dir).stdout, /Nothing to dispatch/, 'HEAD moved but no TypeScript changed')
})

test('integration: committed work on a branch is still audited', () => {
  const dir = makeRepo({ changed: null })
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  git(['checkout', '-q', '-b', 'feature'])
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'src', 'committed.ts'), 'export const z = setInterval(() => {}, 1000)\n')
  git(['add', '.'])
  git(['commit', '-q', '-m', 'feature work'])
  assert.match(runRoute(dir).stdout, /committed\.ts/)
})

test('integration: a deleted TypeScript file is not dispatched to any auditor', () => {
  const dir = makeRepo({ changed: null })
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'src', 'gone.ts'), 'export const x = setInterval(() => {}, 1000)\n')
  git(['add', '.'])
  git(['commit', '-q', '-m', 'add gone.ts'])
  fs.rmSync(path.join(dir, 'src', 'gone.ts'))
  // A surviving change proves the router still routes — the assertion is that
  // the deleted path specifically never reaches an auditor.
  fs.writeFileSync(path.join(dir, 'src', 'model.ts'), 'export const y = setInterval(() => {}, 1000)\n')
  const out = runRoute(dir).stdout
  assert.match(out, /model\.ts/, 'the surviving file still needs an audit')
  assert.ok(!out.includes('gone.ts'), 'a deleted file must not fan out to every auditor')
})

test('integration: a non-git directory is refused, not silently emptied', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reatom-nogit-'))
  const out = runRoute(dir)
  assert.equal(out.status, 1, 'the operator asked for an audit and did not get one')
  assert.match(out.stdout, /Not a git repository/)
})

test('integration: --all audits files no diff would reach', () => {
  const dir = makeRepo({ changed: null })
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'src', 'old.ts'), 'export const x = setInterval(() => {}, 1000)\n')
  git(['add', '.'])
  git(['commit', '-q', '-m', 'pre-existing debt'])

  assert.match(runRoute(dir).stdout, /No auditable TypeScript in scope/, 'the diff cannot see it')
  const all = runRoute(dir, ['--all'])
  assert.equal(all.status, 0, all.stderr)
  assert.match(all.stdout, /old\.ts/, 'a whole-repo sweep can')
})

test('integration: --all ignores the cache on the way in and writes it on the way out', () => {
  const dir = makeRepo()
  assert.match(runRoute(dir).stdout, /audit-lifecycle/)
  assert.match(runRoute(dir, ['--all']).stdout, /model\.ts/, '--all re-audits what the cache already blessed')
  assert.match(runRoute(dir).stdout, /Nothing to dispatch/, 'and leaves the cache current afterwards')
})

test('integration: explicit paths reach a file the diff never saw and leave the cache alone', () => {
  const dir = makeRepo({ changed: null })
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'src', 'old.ts'), 'export const x = setInterval(() => {}, 1000)\n')
  git(['add', '.'])
  git(['commit', '-q', '-m', 'pre-existing debt'])

  const first = runRoute(dir, ['src/old.ts'])
  assert.match(first.stdout, /audit-lifecycle/)
  assert.match(
    runRoute(dir, ['src/old.ts']).stdout,
    /audit-lifecycle/,
    'a named file is audited every time, never cached away'
  )
})

test('integration: the ignore file drops a file from --changed and --all but not from a named path', () => {
  const dir = makeRepo()
  fs.writeFileSync(
    path.join(dir, '.reatom-audit-ignore'),
    '# scanner fixtures, not audit surface\nsrc/model.ts\n'
  )
  assert.match(runRoute(dir).stdout, /No auditable TypeScript in scope/)
  assert.match(runRoute(dir, ['--all']).stdout, /No auditable TypeScript in scope/)
  assert.match(
    runRoute(dir, ['src/model.ts']).stdout,
    /audit-lifecycle/,
    'naming a file overrides the ignore list'
  )
})

test('integration: the pre-0.6 .reatom-gate-ignore name still applies', () => {
  const dir = makeRepo()
  fs.writeFileSync(path.join(dir, '.reatom-gate-ignore'), 'src/model.ts\n')
  assert.match(runRoute(dir).stdout, /No auditable TypeScript in scope/)
})

test('integration: a non-matching ignore file leaves everything in scope', () => {
  const dir = makeRepo()
  fs.writeFileSync(path.join(dir, '.reatom-audit-ignore'), 'tools/\n*.gen.ts\n')
  assert.match(runRoute(dir).stdout, /src[\\/]model\.ts/)
})

test('integration: the bare words the operator types are read as modes, not as paths', () => {
  const dir = makeRepo({ changed: null })
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'src', 'old.ts'), 'export const x = setInterval(() => {}, 1000)\n')
  git(['add', '.'])
  git(['commit', '-q', '-m', 'pre-existing debt'])

  assert.match(runRoute(dir, ['all']).stdout, /old\.ts/, '"all" is the whole-repo sweep')
  assert.match(runRoute(dir, ['changed']).stdout, /No auditable TypeScript in scope/, '"changed" is the diff')

  const init = runRoute(dir, ['init'])
  assert.equal(init.status, 1, 'init is a different script, not an empty audit')
  assert.match(init.stdout, /init-claude-md\.js/)
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
  assert.match(runRoute(dir).stdout, /committed\.ts/)
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
  assert.match(runRoute(dir).stdout, /committed\.ts/)
})

test('integration: with no origin/HEAD and no conventional name, the commit graph picks the base', () => {
  const dir = makeRepo({ changed: null, branch: 'release' })
  commitOnFeatureBranch(dir)
  assert.match(runRoute(dir).stdout, /committed\.ts/)
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
  assert.match(runRoute(dir).stdout, /committed\.ts/, 'origin/feature must not be treated as the base')
})

const BASE_PIN = 'reatom-base-branch'

test('integration: detection pins the base branch into .git', () => {
  const dir = makeRepo({ changed: null, branch: 'master' })
  commitOnFeatureBranch(dir)
  runRoute(dir)
  assert.equal(fs.readFileSync(path.join(dir, '.git', BASE_PIN), 'utf8').trim(), 'refs/heads/master auto')
})

test('integration: a "none" pin narrows the audit to the working tree', () => {
  const dir = makeRepo({ changed: null })
  commitOnFeatureBranch(dir)
  fs.writeFileSync(path.join(dir, '.git', BASE_PIN), 'none\n')
  assert.match(
    runRoute(dir).stdout,
    /No auditable TypeScript in scope/,
    'a none pin drops committed branch work from scope'
  )
})

test('integration: a hand-written pin is used instead of detection', () => {
  const dir = makeRepo({ changed: null, branch: 'master' })
  commitOnFeatureBranch(dir)
  // Pin the feature branch itself: merge-base(HEAD, feature) is HEAD, so the
  // committed diff is empty and nothing reaches an auditor. A detected base
  // would have found refs/heads/master and dispatched.
  fs.writeFileSync(path.join(dir, '.git', BASE_PIN), 'refs/heads/feature\n')
  assert.match(runRoute(dir).stdout, /No auditable TypeScript in scope/, 'the pin overrides detection')
})

test('integration: a pin that no longer resolves falls back to fresh detection', () => {
  const dir = makeRepo({ changed: null, branch: 'master' })
  commitOnFeatureBranch(dir)
  fs.writeFileSync(path.join(dir, '.git', BASE_PIN), 'refs/heads/deleted-branch\n')
  assert.match(runRoute(dir).stdout, /committed\.ts/)
  assert.equal(
    fs.readFileSync(path.join(dir, '.git', BASE_PIN), 'utf8').trim(),
    'refs/heads/master auto',
    'the stale pin is replaced with what detection found'
  )
})

test('integration: a guessed base branch warns once and names the pin file', () => {
  const dir = makeRepo({ changed: null, branch: 'release' })
  commitOnFeatureBranch(dir)
  const first = runRoute(dir).stdout
  assert.match(first, /guessed the base branch as "refs\/heads\/release"/)
  assert.match(first, /reatom-base-branch/)
  assert.match(first, /committed\.ts/, 'the warning rides along with the orders')

  fs.writeFileSync(path.join(dir, 'src', 'other.ts'), 'export const q = setInterval(() => {}, 1000)\n')
  const second = runRoute(dir).stdout
  assert.match(second, /other\.ts/)
  assert.ok(!second.includes('guessed the base branch'), 'the pin silences the repeat warning')
})

test('integration: an undetectable base branch warns and still reports its scope', () => {
  // One branch, no remote, nothing else to compare HEAD against.
  const dir = makeRepo({ changed: null, branch: 'release' })
  const out = runRoute(dir).stdout
  assert.match(out, /could not identify a base branch/)
  assert.match(out, /reatom-base-branch/)
  assert.match(out, /No auditable TypeScript in scope/)
})

test('integration: a base branch found by name warns about nothing', () => {
  const dir = makeRepo({ changed: null, branch: 'master' })
  commitOnFeatureBranch(dir)
  const out = runRoute(dir).stdout
  assert.match(out, /committed\.ts/)
  assert.ok(!out.includes('base branch'), 'a conventional name is not a guess')
})

test('integration: an auto "none" pin self-heals once origin/HEAD appears', () => {
  const dir = makeRepo({ changed: null, branch: 'release' })
  assert.match(runRoute(dir).stdout, /could not identify a base branch/)

  commitOnFeatureBranch(dir)
  // Still nothing origin/HEAD or a conventional name can find — the auto
  // "none" pin still applies, silently, and the committed work stays out of
  // scope because there is no base to diff against.
  const second = runRoute(dir).stdout
  assert.ok(!second.includes('could not identify'), 'no repeat warning on an unchanged auto pin')
  assert.match(second, /No auditable TypeScript in scope/)

  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  const sha = git(['rev-parse', 'refs/heads/release']).stdout.trim()
  git(['update-ref', 'refs/remotes/origin/release', sha])
  git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/release'])

  const third = runRoute(dir).stdout
  assert.match(third, /committed\.ts/, 'the auto pin self-healed once origin/HEAD appeared')
  assert.ok(!third.includes('base branch'), 'the self-heal itself is silent, not a fresh warning')
})

test('integration: a manually-written "none" pin stays sticky even after origin/HEAD appears', () => {
  const dir = makeRepo({ changed: null, branch: 'release' })
  commitOnFeatureBranch(dir)
  fs.writeFileSync(path.join(dir, '.git', BASE_PIN), 'none\n') // no "auto" suffix: a deliberate opt-out
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  const sha = git(['rev-parse', 'refs/heads/release']).stdout.trim()
  git(['update-ref', 'refs/remotes/origin/release', sha])
  git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/release'])
  assert.match(
    runRoute(dir).stdout,
    /No auditable TypeScript in scope/,
    'a manual none is an explicit opt-out and must not self-heal'
  )
})

// REFERENCES in route.js is resolved from the script's own location (__dirname),
// not from the target repo's cwd. So to prove the router reports an unreadable
// rule registry, without touching the checked-out rules.md, we run a scratch
// copy of the plugin — scripts/ plus the reference slices — with rules.md
// withheld from the copy.
function makeRouterWithoutRegistry() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reatom-noregistry-'))
  const scriptsSrc = path.join(__dirname, '..', '..', 'scripts')
  const refsSrc = path.join(__dirname, '..', '..', 'skills', 'reatom', 'references')
  const scriptsDst = path.join(dir, 'scripts')
  const refsDst = path.join(dir, 'skills', 'reatom', 'references')
  fs.mkdirSync(scriptsDst, { recursive: true })
  fs.mkdirSync(refsDst, { recursive: true })
  for (const name of fs.readdirSync(scriptsSrc)) {
    fs.copyFileSync(path.join(scriptsSrc, name), path.join(scriptsDst, name))
  }
  for (const name of fs.readdirSync(refsSrc)) {
    if (name === 'rules.md') continue // the one file this scratch copy withholds
    const src = path.join(refsSrc, name)
    if (fs.statSync(src).isDirectory()) continue
    fs.copyFileSync(src, path.join(refsDst, name))
  }
  return path.join(scriptsDst, 'route.js')
}

test('integration: an unreadable rule registry is reported, not silently skipped', () => {
  const dir = makeRepo()
  const result = spawnSync('node', [makeRouterWithoutRegistry()], { cwd: dir, encoding: 'utf8' })
  assert.equal(result.status, 1, 'a missing registry is a failure, not an empty audit')
  assert.match(result.stdout, /Cannot read the rule registry/)
  assert.equal(result.stderr.trim(), '', 'no stack trace reaches stderr')
})

const RULES = fs.readFileSync(
  path.join(__dirname, '..', '..', 'skills', 'reatom', 'references', 'rules.md'),
  'utf8'
)
const TRIGGERS = buildTriggers(RULES)

test('buildTriggers unions each domain rules tokens', () => {
  assert.ok(TRIGGERS.async.includes('useEffect'), 'async inherits RTM-A01')
  assert.ok(TRIGGERS.lifecycle.includes('setInterval'), 'lifecycle inherits RTM-L01')
  assert.ok(!TRIGGERS.lifecycle.includes('useEffect'), 'domains do not leak into each other')
  for (const domain of DOMAINS) {
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

const SLICES = { async: 'A', state: 'S', lifecycle: 'L', 'routing-forms': 'R', react: 'C' }
const readSlice = (domain) => SLICES[domain]

function planFor(files, contents, cache = {}) {
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
  const start = pairHash('file contents', 'slice contents')
  assert.notEqual(pairHash('other contents', 'slice contents'), start)
  assert.notEqual(pairHash('file contents', 'other slice'), start)
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
  const { assignments, notDispatched } = planFor(['src/poll.ts'], contents)
  assert.ok(assignments.lifecycle.includes('src/poll.ts'))
  assert.ok(notDispatched.includes('routing-forms'), 'a domain with no work is not dispatched')
  assert.ok(!('routing-forms' in assignments), 'empty domains are absent, not empty arrays')
})

test('a domain that is fully cached is distinguished from a domain never routed to', () => {
  const contents = { 'src/poll.ts': fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', 'violations', 'polling-timer.ts'), 'utf8') }
  const first = planFor(['src/poll.ts'], contents)
  assert.ok(first.assignments.lifecycle.includes('src/poll.ts'))
  assert.ok(first.notDispatched.includes('routing-forms'), 'never routed to this file')
  assert.deepEqual(first.fullyCached, [], 'nothing is cached on the first run')

  const second = planFor(['src/poll.ts'], contents, first.nextCache)
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
  const first = planFor(['src/a.ts'], contents)
  assert.ok(Object.keys(first.assignments).length > 0)
  const second = planFor(['src/a.ts'], contents, first.nextCache)
  assert.deepEqual(second.assignments, {}, 'nothing to re-audit')
  assert.ok(second.skipped > 0, 'and the skip is counted')
})

test('changed contents re-audit even when the file list is identical', () => {
  const before = { 'src/a.ts': 'export const x = atom(1, "x")\n' }
  const after = { 'src/a.ts': 'export const x = atom(2, "x")\n' }
  const first = planFor(['src/a.ts'], before)
  const second = planFor(['src/a.ts'], after, first.nextCache)
  assert.ok(Object.keys(second.assignments).length > 0, 'content edits are not invisible')
})

test('editing one domain slice invalidates that domain and no other', () => {
  const contents = { 'src/a.ts': 'const t = setInterval(f, 1)\nconst x = atom(1, "x")\n' }
  const first = planFor(['src/a.ts'], contents)
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
  const first = planFor(['src/a.ts', 'src/b.ts'], contents)
  const second = planFor(['src/a.ts'], contents, first.nextCache)
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

test('a trailing double star ignores everything under the directory', () => {
  assert.deepEqual(filterIgnored(['src/a.ts', 'src.ts'], ['src/**']), ['src.ts'])
})

test('a lone double star ignores everything', () => {
  assert.deepEqual(filterIgnored(['src/a.ts', 'b.ts'], ['**']), [])
})

test('a bare slash pattern matches nothing', () => {
  assert.deepEqual(filterIgnored(['src/a.ts', 'a.ts'], ['/']), ['src/a.ts', 'a.ts'])
})

function runInit(dir) {
  return spawnSync('node', [INIT], { cwd: dir, encoding: 'utf8' })
}

function scratch() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'reatom-init-'))
}

const OPEN = '<reatom-audit>'
const CLOSE = '</reatom-audit>'

test('init writes a CLAUDE.md that does not exist yet', () => {
  const dir = scratch()
  const out = runInit(dir)
  assert.equal(out.status, 0, out.stderr)
  assert.match(out.stdout, /^Created /)
  const written = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8')
  assert.ok(written.includes(OPEN) && written.includes(CLOSE), 'the block is tag-delimited')
  assert.match(written, /\/reatom-audit/, 'the block names the command')
  assert.match(written, /\/reatom-audit all/, 'and the whole-repository form')
})

test('init is idempotent', () => {
  const dir = scratch()
  runInit(dir)
  const before = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8')
  const out = runInit(dir)
  assert.match(out.stdout, /already carries the current/)
  assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), before, 'byte-for-byte unchanged')
})

test('init appends to an existing CLAUDE.md without disturbing it', () => {
  const dir = scratch()
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Project\n\nExisting rules.\n')
  const out = runInit(dir)
  assert.match(out.stdout, /^Appended /)
  const written = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8')
  assert.ok(written.startsWith('# Project\n\nExisting rules.\n'), 'the existing content survives verbatim')
  assert.ok(written.indexOf('Existing rules.') < written.indexOf(OPEN), 'the block goes at the end')
})

test('init rewrites whatever sits between the tags and leaves the tags alone', () => {
  const dir = scratch()
  fs.writeFileSync(
    path.join(dir, 'CLAUDE.md'),
    `# Project\n\n${OPEN}\nwording from an older release\n${CLOSE}\n\n## House rules\n\nkeep me\n`
  )
  const out = runInit(dir)
  assert.match(out.stdout, /^Rewrote /)
  const written = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8')
  assert.ok(!written.includes('wording from an older release'), 'the stale body is gone')
  assert.match(written, /Run `\/reatom-audit` when you finish a change/, 'the current body is in')
  assert.match(written, /## House rules/)
  assert.match(written, /keep me/)
  assert.equal(written.split(OPEN).length - 1, 1, 'exactly one block, not two')
})

test('init rewrites an empty block too', () => {
  const dir = scratch()
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), `# Project\n\n${OPEN}${CLOSE}\n`)
  assert.match(runInit(dir).stdout, /^Rewrote /)
  assert.match(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), /\/reatom-audit all/)
})

test('init refuses an unclosed tag', () => {
  const dir = scratch()
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), `# Project\n\n${OPEN}\nhalf a block\n`)
  const out = runInit(dir)
  assert.equal(out.status, 1, 'a broken block is not something to guess at')
  assert.match(out.stdout, /expected one of each/)
  assert.match(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), /half a block/, 'and nothing was written')
})

test('init refuses a file carrying two blocks', () => {
  const dir = scratch()
  fs.writeFileSync(
    path.join(dir, 'CLAUDE.md'),
    `${OPEN}\nfirst\n${CLOSE}\n\n${OPEN}\nsecond\n${CLOSE}\n`
  )
  const out = runInit(dir)
  assert.equal(out.status, 1, 'rewriting one would leave the other still instructing the agent')
  assert.match(out.stdout, /2 <reatom-audit> and 2 <\/reatom-audit>/)
  const written = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8')
  assert.match(written, /first/)
  assert.match(written, /second/)
})
