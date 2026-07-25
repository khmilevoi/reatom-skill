const fs = require('node:fs')
const path = require('node:path')

// One paired tag rather than two comment markers: the content between them is
// rewritten wholesale on every run, so the wording can change from release to
// release without the operator having to notice or intervene. The tags
// themselves are never rewritten — whatever indentation or surroundings the
// file already gives them survives.
const OPEN = '<reatom-audit>'
const CLOSE = '</reatom-audit>'

// The whole point of the plugin after 0.6: nothing fires on its own, so this
// paragraph is the only thing that tells an agent when the audit is due.
const BODY = [
  'This project uses Reatom, and the `reatom` plugin ships an audit that checks',
  'TypeScript against the Reatom rule registry.',
  '',
  'Run `/reatom-audit` when you finish a change that touched Reatom code — atoms,',
  'computed values, actions, async flows, effects, `reatomComponent` — and before',
  'you report that work as done. It audits changed TypeScript only, and it is',
  'incremental, so re-running it after a small follow-up edit is cheap. Skip it',
  'entirely for changes that touch no Reatom code.',
  '',
  'Two other forms exist: `/reatom-audit all` sweeps every TypeScript file in the',
  'repository, and `/reatom-audit <paths>` audits exactly the files you name,',
  'whether or not they changed. Both are for the operator to invoke; neither is',
  'part of finishing an ordinary change.'
].join('\n')

const INNER = '\n' + BODY + '\n'
const BLOCK = OPEN + INNER + CLOSE

function count(text, needle) {
  return text.split(needle).length - 1
}

function fail(message) {
  process.stdout.write(message + '\n')
  process.exitCode = 1
}

function main() {
  const target = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(process.cwd(), 'CLAUDE.md')

  let existing = null
  try {
    existing = fs.readFileSync(target, 'utf8')
  } catch {
    // no file yet → created below
  }

  if (existing === null) {
    fs.writeFileSync(target, BLOCK + '\n')
    process.stdout.write(`Created ${target} with the reatom-audit block.\n`)
    return
  }

  const opens = count(existing, OPEN)
  const closes = count(existing, CLOSE)

  // Anything other than a clean pair is a file someone edited by hand and
  // broke. Rewriting the first pair would leave a second, stale block still
  // instructing the agent, and guessing where an unclosed one ends would eat
  // their prose — so this stops and says what it found.
  if (opens !== closes || opens > 1) {
    return fail(
      `${target} has ${opens} ${OPEN} and ${closes} ${CLOSE} — expected one of each. ` +
      'Repair it by hand, then re-run.'
    )
  }

  if (opens === 1) {
    const start = existing.indexOf(OPEN) + OPEN.length
    const end = existing.indexOf(CLOSE)
    if (end < existing.indexOf(OPEN)) {
      return fail(`${target} closes the reatom-audit block before it opens it. Repair it by hand.`)
    }
    if (existing.slice(start, end) === INNER) {
      process.stdout.write(`${target} already carries the current reatom-audit block.\n`)
      return
    }
    fs.writeFileSync(target, existing.slice(0, start) + INNER + existing.slice(end))
    process.stdout.write(`Rewrote the reatom-audit block in ${target}.\n`)
    return
  }

  const separator = existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n'
  fs.writeFileSync(target, existing + separator + BLOCK + '\n')
  process.stdout.write(`Appended the reatom-audit block to ${target}.\n`)
}

main()
