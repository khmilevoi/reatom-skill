const DOMAINS = ['async', 'state', 'lifecycle', 'routing-forms', 'react']

const SLICE_BANNER =
  '<!-- GENERATED from rules.md by development/build-rule-slices.js. DO NOT EDIT. -->'

function sliceFileName(domain) {
  return `rules-${domain}.md`
}

function sliceRegistry(rulesText) {
  const blocks = rulesText
    .split(/^### /m)
    .slice(1)
    .map((block) => '### ' + block.trimEnd())

  const grouped = Object.fromEntries(DOMAINS.map((d) => [d, []]))
  for (const block of blocks) {
    const id = block.slice(4, block.indexOf(' ', 4))
    const domain = (block.match(/^- domain: (.+)$/m) || [])[1]
    if (!DOMAINS.includes(domain)) throw new Error(`${id} declares unknown domain "${domain}"`)
    grouped[domain].push(block)
  }

  const out = {}
  for (const domain of DOMAINS) {
    out[domain] = [
      SLICE_BANNER,
      '',
      `# Reatom rule registry — ${domain}`,
      '',
      `The \`${domain}\` slice of \`rules.md\`. Rules from other domains are owned by`,
      'other auditors and are deliberately absent.',
      '',
      grouped[domain].join('\n\n'),
      ''
    ].join('\n')
  }
  return out
}

module.exports = { DOMAINS, SLICE_BANNER, sliceFileName, sliceRegistry }
