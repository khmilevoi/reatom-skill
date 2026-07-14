const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

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
    assert.ok(brief.includes('references/rules.md'), `${name} points at the registry`)
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
