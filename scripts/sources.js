const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { readState, statePath, parsePin } = require('./state')

const SOURCES_STATE = 'sources'
const NO_SOURCES = 'none'

// The branch the vendored handbook under references/upstream/ is cut from.
// Keeping them on the same ref is what lets the skill treat the two as one
// story told at two levels of detail.
const REF = 'v1001'
const REMOTE = 'https://github.com/reatom/reatom.git'

const CACHE_NAMESPACE = 'reatom-claude-plugin'
const CLONE_LEAF = 'sources'

// One clone per machine, in the OS cache location, because nothing about it is
// project-specific: every project wants the same 29 MB of reatom@v1001.
function defaultSourcesPath(env = process.env, platform = process.platform) {
  const base = platform === 'win32'
    ? env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
    : env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache')
  return path.join(base, CACHE_NAMESPACE, CLONE_LEAF)
}

// `.git` inside, not merely the directory: a half-deleted or freshly-made
// empty directory must not read as a checkout and send the skill reading
// files that are not there.
function isClone(dir, exists) {
  return Boolean(dir) && exists(path.join(dir, '.git'))
}

function resolveSources(cwd, { env, platform, exists = fs.existsSync } = {}) {
  const pin = parsePin(readState(cwd, SOURCES_STATE))
  const pinFile = statePath(cwd, SOURCES_STATE)

  if (pin && pin.value === NO_SOURCES) {
    return { status: 'disabled', path: null, pinFile, pinned: true }
  }

  if (pin) {
    return {
      status: isClone(pin.value, exists) ? 'ok' : 'pinned-missing',
      path: pin.value,
      pinFile,
      pinned: true
    }
  }

  const fallback = defaultSourcesPath(env, platform)
  return {
    status: isClone(fallback, exists) ? 'ok' : 'missing',
    path: fallback,
    pinFile,
    pinned: false
  }
}

module.exports = {
  REF,
  REMOTE,
  SOURCES_STATE,
  NO_SOURCES,
  defaultSourcesPath,
  resolveSources
}
