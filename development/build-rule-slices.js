const fs = require('node:fs')
const path = require('node:path')
const { DOMAINS, sliceFileName, sliceRegistry } = require('./rule-slices')

const REFERENCES = path.join(__dirname, '..', 'skills', 'reatom', 'references')

function main() {
  const rules = fs.readFileSync(path.join(REFERENCES, 'rules.md'), 'utf8')
  const slices = sliceRegistry(rules)
  for (const domain of DOMAINS) {
    const target = path.join(REFERENCES, sliceFileName(domain))
    fs.writeFileSync(target, slices[domain])
    process.stdout.write(`wrote ${sliceFileName(domain)}\n`)
  }
}

main()
