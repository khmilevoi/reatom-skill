#!/usr/bin/env node
// Copies the upstream agent-skill references into skills/reatom/references/upstream/.
// The clone is development-only and gitignored; see development/README.md.
//
// Verbatim means no hand edits. This script applies exactly two declared
// transforms, both to review.md, and nothing else.

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')

const ROOT = path.join(__dirname, '..')
const CLONE = path.join(__dirname, 'upstream', 'reatom')
const OUT = path.join(ROOT, 'skills', 'reatom', 'references', 'upstream')

const SOURCES = [
  { from: 'skills/reatom/REFERENCE.md', to: 'core.md' },
  { from: 'skills/reatom-async/REFERENCE.md', to: 'async.md' },
  { from: 'skills/reatom-jsx/REFERENCE.md', to: 'jsx.md' },
  { from: 'skills/reatom-review/SKILL.md', to: 'review.md' }
]

function git(args) {
  const r = spawnSync('git', args, { cwd: CLONE, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${CLONE}`)
  return r.stdout.trim()
}

// review.md is the only vendored file with relative links or skill frontmatter.
// Its frontmatter would otherwise declare a skill that references/ does not contain.
function transform(name, text) {
  if (name !== 'review.md') return text
  return text
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .split('](../reatom/REFERENCE.md)')
    .join('](./core.md)')
}

function main() {
  if (!fs.existsSync(CLONE)) {
    console.error(`No clone at ${CLONE}`)
    console.error('See development/README.md for the clone command.')
    process.exit(1)
  }

  const sha = git(['rev-parse', 'HEAD'])
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
  const short = sha.slice(0, 8)
  const date = new Date().toISOString().slice(0, 10)

  fs.rmSync(OUT, { recursive: true, force: true })
  fs.mkdirSync(OUT, { recursive: true })

  const record = [
    'upstream: reatom/reatom',
    `branch:   ${branch}`,
    `commit:   ${sha}`,
    `synced:   ${date}`,
    '',
    'sha256 of each source file at that commit:'
  ]

  for (const { from, to } of SOURCES) {
    const source = fs.readFileSync(path.join(CLONE, from), 'utf8')
    const digest = crypto.createHash('sha256').update(source).digest('hex')
    const banner =
      `<!-- VENDORED reatom/reatom@${short} (${branch}) ${from}\n` +
      '     DO NOT EDIT. Regenerate: node development/sync-upstream.js -->'
    fs.writeFileSync(path.join(OUT, to), `${banner}\n\n${transform(to, source)}`)
    record.push(`  ${to.padEnd(10)} ${digest}  ${from}`)
  }

  fs.writeFileSync(path.join(OUT, 'VERSION'), record.join('\n') + '\n')
  console.log(`Synced ${SOURCES.length} files from reatom/reatom@${short} (${branch})`)
}

main()
