const fs = require('node:fs')
const path = require('node:path')
const { auditableFiles, gateDecision, buildTriggers, planAudit } = require('./gate-logic')

const REFERENCES = path.join(__dirname, '..', 'skills', 'reatom', 'references')

function main() {
  const args = process.argv.slice(2)
  const files = auditableFiles(args)
  if (files.length === 0) {
    process.stdout.write('No auditable TypeScript in the given paths.\n')
    return
  }

  const rules = fs.readFileSync(path.join(REFERENCES, 'rules.md'), 'utf8')
  const plan = planAudit({
    files,
    readFile: (f) => fs.readFileSync(f, 'utf8'),
    readSlice: (d) => fs.readFileSync(path.join(REFERENCES, `rules-${d}.md`), 'utf8'),
    cache: {},
    triggers: buildTriggers(rules)
  })

  const decision = gateDecision({
    stopHookActive: false,
    isGitRepo: true,
    isReatomProject: true,
    auditableFiles: files,
    plan
  })
  process.stdout.write((decision.reason || 'Nothing to audit.') + '\n')
}

main()
