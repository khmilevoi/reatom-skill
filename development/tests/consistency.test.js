const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { sliceRegistry, sliceFileName, DOMAINS: SLICE_DOMAINS } = require('../rule-slices')

const ROOT = path.join(__dirname, '..', '..')
const SKILL_DIR = path.join(ROOT, 'skills', 'reatom')
const UPSTREAM_DIR = path.join(SKILL_DIR, 'references', 'upstream')

function read(...parts) {
  return fs.readFileSync(path.join(SKILL_DIR, ...parts), 'utf8')
}

function headings(text) {
  return [...text.matchAll(/^#{1,6} (.+)$/gm)].map((m) => m[1].trim())
}

const VENDORED = ['async.md', 'core.md', 'jsx.md', 'review.md']
const BANNER = /^<!-- VENDORED reatom\/reatom@[0-9a-f]{7,40} \(.+\) .+$/m

test('every vendored file carries the banner and is recorded in VERSION', () => {
  const version = fs.readFileSync(path.join(UPSTREAM_DIR, 'VERSION'), 'utf8')
  const found = fs.readdirSync(UPSTREAM_DIR).filter((f) => f.endsWith('.md')).sort()
  assert.deepEqual(found, VENDORED, 'exactly the four upstream references are vendored')

  for (const file of found) {
    const text = fs.readFileSync(path.join(UPSTREAM_DIR, file), 'utf8')
    assert.match(text, BANNER, `${file} is missing the VENDORED banner`)
    assert.ok(version.includes(file), `${file} is not recorded in VERSION`)
  }
})

test('the vendored review keeps no skill frontmatter and no dead relative links', () => {
  const review = fs.readFileSync(path.join(UPSTREAM_DIR, 'review.md'), 'utf8')
  assert.doesNotMatch(review, /^---\r?\nname: reatom-review/m, 'frontmatter declaring a skill was stripped')
  assert.ok(!review.includes('](../reatom/REFERENCE.md)'), 'relative links were repointed')
  assert.ok(review.includes('](./core.md)'), 'links now resolve inside references/upstream')
})

const RULE_HEADING = /^### (RTM-[ASLRC]\d{2}) — .+$/gm
const DOMAINS = ['async', 'state', 'lifecycle', 'routing-forms', 'react']
const KINDS = ['reinvention', 'anti-pattern', 'hygiene']

const AUDITORS = {
  'audit-async': 'async',
  'audit-state': 'state',
  'audit-lifecycle': 'lifecycle',
  'audit-routing-forms': 'routing-forms',
  'audit-react': 'react'
}

function ruleIds(text) {
  return [...text.matchAll(RULE_HEADING)].map((m) => m[1])
}

test('every rule has a unique id, a known domain and a known kind', () => {
  const rules = read('references', 'rules.md')
  const ids = ruleIds(rules)
  assert.ok(ids.length >= 10, `expected a populated registry, got ${ids.length}`)
  assert.equal(new Set(ids).size, ids.length, 'rule ids are unique')

  const blocks = rules.split(/^### /m).slice(1)
  for (const block of blocks) {
    const id = block.slice(0, block.indexOf(' '))
    const domain = (block.match(/^- domain: (.+)$/m) || [])[1]
    const kind = (block.match(/^- kind: (.+)$/m) || [])[1]
    assert.ok(DOMAINS.includes(domain), `${id} domain "${domain}" is known`)
    assert.ok(KINDS.includes(kind), `${id} kind "${kind}" is known`)
    assert.match(block, /^- bad: /m, `${id} shows a bad example`)
    assert.match(block, /^- good: /m, `${id} shows a good example`)
    assert.match(block, /^- detect: /m, `${id} says how to detect it`)
    assert.match(block, /^- ref: /m, `${id} cites a reference section`)
  }
})

const PREFIX_DOMAIN = { A: 'async', S: 'state', L: 'lifecycle', R: 'routing-forms', C: 'react' }

test('every rule id prefix agrees with its declared domain', () => {
  const rules = read('references', 'rules.md')
  const blocks = rules.split(/^### /m).slice(1)
  const wrong = []
  for (const block of blocks) {
    const id = block.slice(0, block.indexOf(' '))
    const domain = (block.match(/^- domain: (.+)$/m) || [])[1]
    const letter = id.slice(4, 5)
    if (PREFIX_DOMAIN[letter] !== domain) wrong.push(`${id} is domain "${domain}"`)
  }
  assert.deepEqual(wrong, [], `id prefixes disagree with domains: ${wrong.join(' | ')}`)
})

test('every registry rule is owned by exactly one auditor domain', () => {
  const rules = read('references', 'rules.md')
  const owned = new Set(Object.values(AUDITORS))
  const blocks = rules.split(/^### /m).slice(1)
  for (const block of blocks) {
    const id = block.slice(0, block.indexOf(' '))
    const domain = (block.match(/^- domain: (.+)$/m) || [])[1]
    assert.ok(owned.has(domain), `${id} domain "${domain}" has an auditor`)
  }
})

test('every auditor is read-only, named, and points at the registry', () => {
  for (const [name, domain] of Object.entries(AUDITORS)) {
    const brief = fs.readFileSync(path.join(ROOT, 'agents', `${name}.md`), 'utf8')
    assert.match(brief, new RegExp(`^name: ${name}$`, 'm'), `${name} declares its name`)
    assert.match(brief, /^tools: Read, Grep, Glob$/m, `${name} is read-only`)
    assert.ok(
      brief.includes(`references/rules-${domain}.md`),
      `${name} points at its own slice`
    )
    assert.ok(
      !brief.includes('references/rules.md'),
      `${name} does not also pull the whole registry`
    )
    assert.ok(brief.includes(domain), `${name} names its domain`)
  }
})

test('the gate dispatches exactly the auditors that exist', () => {
  const { gateDecision } = require(path.join(ROOT, 'hooks', 'gate-logic'))
  const decision = gateDecision({
    stopHookActive: false,
    isGitRepo: true,
    isReatomProject: true,
    auditableFiles: ['src/model.ts'],
    marker: 'M1',
    lastMarker: null
  })
  assert.equal(decision.block, true)
  for (const name of Object.keys(AUDITORS)) {
    assert.ok(decision.reason.includes(name), `the gate dispatches ${name}`)
    assert.ok(fs.existsSync(path.join(ROOT, 'agents', `${name}.md`)), `${name}.md exists`)
  }
})

test('hooks.json registers the Stop gate through the plugin root', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8'))
  const command = hooks.hooks.Stop[0].hooks[0].command
  assert.ok(command.includes('${CLAUDE_PLUGIN_ROOT}'), 'the gate is resolved from the plugin root')
  assert.ok(command.includes('reatom-gate.js'), 'the gate script is named')
  assert.ok(fs.existsSync(path.join(ROOT, 'hooks', 'reatom-gate.js')), 'the gate script exists')
})

test('SKILL.md and rules.md reference exactly the same rule ids', () => {
  const rules = read('references', 'rules.md')
  const skill = read('SKILL.md')
  const inRules = new Set(ruleIds(rules))
  const inSkill = new Set([...skill.matchAll(/RTM-[ASLRC]\d{2}/g)].map((m) => m[0]))

  const missingFromSkill = [...inRules].filter((id) => !inSkill.has(id))
  const unknownInSkill = [...inSkill].filter((id) => !inRules.has(id))

  assert.deepEqual(missingFromSkill, [], 'every registry rule is tagged in SKILL.md')
  assert.deepEqual(unknownInSkill, [], 'SKILL.md cites no rule absent from the registry')
})

const REF = /^- ref: ([^#\n]+)#(.+)$/gm

test('every rule ref resolves to a real heading in a real file', () => {
  const rules = read('references', 'rules.md')
  const refs = [...rules.matchAll(REF)].map((m) => ({ file: m[1].trim(), anchor: m[2].trim() }))
  assert.ok(refs.length >= 15, `expected a populated ref set, got ${refs.length}`)

  const cache = new Map()
  const broken = []
  for (const { file, anchor } of refs) {
    if (!cache.has(file)) {
      const full = path.join(SKILL_DIR, 'references', file)
      cache.set(file, fs.existsSync(full) ? headings(fs.readFileSync(full, 'utf8')) : null)
    }
    const found = cache.get(file)
    if (found === null) broken.push(`${file} (no such file)`)
    else if (!found.includes(anchor)) broken.push(`${file}#${anchor}`)
  }
  assert.deepEqual(broken, [], `refs do not resolve: ${broken.join(' | ')}`)
})

// A "- `references/x.md`" bullet followed by indented "  - `Section`" bullets.
function referenceMap(skillText) {
  const promised = []
  let current = null
  for (const line of skillText.split('\n')) {
    const file = line.match(/^- `(references\/[^`]+)`\s*$/)
    if (file) {
      current = file[1]
      continue
    }
    const section = line.match(/^\s+- `([^`]+)`\s*$/)
    if (section && current) promised.push({ file: current, section: section[1] })
    else if (/^\S/.test(line)) current = null
  }
  return promised
}

test('every section the Reference Map promises exists in the file it names', () => {
  const skill = read('SKILL.md')
  const promised = referenceMap(skill)
  assert.ok(promised.length >= 10, `expected a populated Reference Map, got ${promised.length}`)

  const missing = promised
    .filter(({ file, section }) => {
      const full = path.join(SKILL_DIR, file)
      if (!fs.existsSync(full)) return true
      return !headings(fs.readFileSync(full, 'utf8')).includes(section)
    })
    .map(({ file, section }) => `${file}#${section}`)

  assert.deepEqual(missing, [], `Reference Map promises missing sections: ${missing.join(' | ')}`)
})

test('SKILL.md points at node_modules and not at a bundled repo', () => {
  const skill = read('SKILL.md')
  assert.ok(!skill.includes('assets/reatom'), 'the bundled repo is gone')
  assert.ok(!skill.includes('llm.md'), 'the fork is gone')
  assert.ok(skill.includes('node_modules/@reatom/core/dist/index.d.ts'), 'core types are cited')
  assert.ok(!/v1000/.test(skill), 'the skill is v1001')
})

function markdownFiles(dir, skipDir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) { if (full !== skipDir) out.push(...markdownFiles(full, skipDir)) }
    else if (entry.name.endsWith('.md')) out.push(full)
  }
  return out
}

const LINK = /\[[^\]]*\]\(([^)]+)\)/g

// references/upstream/** is vendored (DO NOT EDIT, regenerated only by
// development/sync-upstream.js). A dead link inside it is unactionable without
// hand-editing the vendor, so it is excluded from this walk.
test('every relative link under skills/ resolves to a real file', () => {
  const files = markdownFiles(path.join(ROOT, 'skills'), UPSTREAM_DIR)
  const broken = []
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    for (const [, target] of text.matchAll(LINK)) {
      if (/^(https?:|mailto:)/.test(target) || target.startsWith('#')) continue
      const clean = target.trim().split('#')[0]
      if (clean && !fs.existsSync(path.join(path.dirname(file), clean))) {
        broken.push(`${path.relative(ROOT, file)} -> ${target}`)
      }
    }
  }
  assert.deepEqual(broken, [], `broken relative links: ${broken.join(' | ')}`)
})

test('every rule declares at least one non-empty trigger token', () => {
  const rules = read('references', 'rules.md')
  const blocks = rules.split(/^### /m).slice(1)
  const bad = []
  for (const block of blocks) {
    const id = block.slice(0, block.indexOf(' '))
    const line = (block.match(/^- trigger: (.+)$/m) || [])[1]
    if (!line) { bad.push(`${id} has no trigger`); continue }
    const tokens = line.split(',').map((t) => t.trim()).filter(Boolean)
    if (tokens.length === 0) bad.push(`${id} has an empty trigger list`)
  }
  assert.deepEqual(bad, [], `trigger declarations missing: ${bad.join(' | ')}`)
})

test('each generated slice is byte-equal to a fresh regeneration', () => {
  const rules = read('references', 'rules.md')
  const generated = sliceRegistry(rules)
  for (const domain of SLICE_DOMAINS) {
    const onDisk = read('references', sliceFileName(domain))
    assert.equal(onDisk, generated[domain], `${sliceFileName(domain)} is stale — run npm run build-slices`)
  }
})

test('every domain has a non-empty slice carrying its own rules only', () => {
  const rules = read('references', 'rules.md')
  const generated = sliceRegistry(rules)
  for (const domain of SLICE_DOMAINS) {
    const ids = ruleIds(generated[domain])
    assert.ok(ids.length > 0, `${domain} slice has no rules`)
    for (const id of ids) {
      const block = rules.split(/^### /m).slice(1).find((b) => b.startsWith(id))
      assert.match(block, new RegExp(`^- domain: ${domain}$`, 'm'), `${id} is in the wrong slice`)
    }
  }
})
