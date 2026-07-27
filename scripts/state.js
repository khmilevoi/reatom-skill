const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

// Everything this plugin remembers about a project lives in one directory
// inside the repository's own git dir: it is already ignored, already
// per-clone, and a directory keeps our files from being mistaken for git's.
const STATE_DIR = '.reatom-plugin'

// The flat pre-0.7 names. Read-only, forever: a base-branch pin written by
// hand is operator intent, and losing it on upgrade sends the router back to
// guessing. Writes always go to STATE_DIR, so the first write ends the
// ambiguity for that file.
const LEGACY_PREFIX = 'reatom-'

const AUTO_SUFFIX = ' auto'

function gitDir(cwd) {
  const r = spawnSync('git', ['rev-parse', '--git-dir'], { cwd, encoding: 'utf8' })
  if (r.status !== 0) return null
  const dir = r.stdout.trim()
  return dir ? path.resolve(cwd, dir) : null
}

function statePath(cwd, name) {
  const dir = gitDir(cwd)
  return dir === null ? null : path.join(dir, STATE_DIR, name)
}

function readState(cwd, name) {
  const dir = gitDir(cwd)
  if (dir === null) return null
  const candidates = [path.join(dir, STATE_DIR, name), path.join(dir, LEGACY_PREFIX + name)]
  for (const file of candidates) {
    try {
      return fs.readFileSync(file, 'utf8')
    } catch {
      // try the legacy name, then give up
    }
  }
  return null
}

function writeState(cwd, name, text) {
  const file = statePath(cwd, name)
  if (file === null) return false
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text)
    return true
  } catch {
    return false
  }
}

// A pin the tooling wrote is marked so it can be revisited cheaply; a pin the
// operator wrote by hand (no suffix) is trusted forever, which is the whole
// point of letting them override a wrong answer.
function parsePin(raw) {
  const trimmed = (raw || '').trim()
  if (!trimmed) return null
  if (trimmed.endsWith(AUTO_SUFFIX)) {
    return { value: trimmed.slice(0, -AUTO_SUFFIX.length), auto: true }
  }
  return { value: trimmed, auto: false }
}

function formatPin(value, { auto = true } = {}) {
  return auto ? value + AUTO_SUFFIX + '\n' : value + '\n'
}

module.exports = {
  STATE_DIR,
  AUTO_SUFFIX,
  gitDir,
  statePath,
  readState,
  writeState,
  parsePin,
  formatPin
}
