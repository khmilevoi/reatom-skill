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
  assert.doesNotMatch(review, /^---\nname: reatom-review/m, 'frontmatter declaring a skill was stripped')
  assert.ok(!review.includes('](../reatom/REFERENCE.md)'), 'relative links were repointed')
  assert.ok(review.includes('](./core.md)'), 'links now resolve inside references/upstream')
})
