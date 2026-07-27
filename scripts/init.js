const path = require('node:path')
const { applyBlock } = require('./claude-md')
const { ensureSources, describeClone, REF, SOURCES_STATE, NO_SOURCES } = require('./sources')
const { readState, statePath, parsePin, writeState, formatPin } = require('./state')

const PAD = '           '

// Two independent jobs. The CLAUDE.md block does not need the network and is
// written first, so a machine that cannot reach GitHub still gets the half
// that matters most. Each job reports its own outcome; a half-success reported
// as success is the one thing this plugin refuses to do.
function main() {
  const cwd = process.cwd()

  const block = applyBlock(path.join(cwd, 'CLAUDE.md'))
  const lines = [`CLAUDE.md: ${block.message}`]
  let ok = block.ok

  try {
    // A bare pin — no `auto` suffix — is the operator's word, and it is
    // trusted forever: init must not overwrite a hand-picked checkout, and it
    // must not silently re-enable sources someone deliberately disabled by
    // pinning "none". Only "no pin" or a tooling-written `auto` pin means
    // init still owns this file.
    const pinFile = statePath(cwd, SOURCES_STATE)
    const pin = parsePin(readState(cwd, SOURCES_STATE))

    if (pin && !pin.auto && pin.value === NO_SOURCES) {
      lines.push(`sources:   disabled by ${pinFile} ("${NO_SOURCES}") — left alone, nothing fetched`)
    } else if (pin && !pin.auto) {
      lines.push(`sources:   pinned by hand to ${pin.value} in ${pinFile} — left alone`)
    } else {
      const { action, path: clone } = ensureSources({})
      const info = describeClone(clone)
      const at = info ? `${info.commit} (${info.ref})` : REF
      lines.push(`sources:   ${action} reatom/reatom@${at} in ${clone}`)

      if (pinFile === null) {
        lines.push(`${PAD}not pinned — this is not a git repository, so the default path is used`)
      } else if (writeState(cwd, SOURCES_STATE, formatPin(clone))) {
        lines.push(`${PAD}pinned in ${pinFile}`)
      } else {
        lines.push(`${PAD}not pinned — could not write ${pinFile}, so the default path is used`)
      }
    }
  } catch (e) {
    ok = false
    lines.push(`sources:   FAILED — ${e.message}`)
    lines.push(`${PAD}The CLAUDE.md block above was still written.`)
    lines.push(`${PAD}Re-run /reatom-audit init to retry the clone.`)
  }

  process.stdout.write(lines.join('\n') + '\n')
  if (!ok) process.exitCode = 1
}

main()
