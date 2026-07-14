# Developing this skill

Nothing in this directory ships. It holds the upstream clone, the vendor sync script,
the audit calibration corpus, and the tests.

## Setup

`references/upstream/` is vendored from the Reatom repo. To re-sync it you need the
clone, which is gitignored:

```bash
git clone -b v1001 https://github.com/reatom/reatom.git development/upstream/reatom
```

## Re-syncing the vendored references

```bash
node development/sync-upstream.js
```

This overwrites `skills/reatom/references/upstream/` from the clone and rewrites its
`VERSION`. **Never hand-edit those files.** Every one carries a banner saying so, and a
test enforces it. Hand-editing is how `references/llm.md` became a fork that drifted 254
lines behind upstream while teaching a stale API contract — the mistake this layout
exists to prevent.

Review the diff after syncing. It is the only review the vendored content gets.

## Tests

```bash
npm test
```

- `gate.test.js` — the Stop gate's logic, including integration tests over real git
  repos. This is the only executable code in the plugin, and it can wedge a session
  shut, so it carries the most tests.
- `consistency.test.js` — the string bindings between markdown files. There is no
  compiler here: `gate-logic.js` names auditors by string, auditors name domains by
  string, and rules name reference anchors by string. These tests are what a compiler
  would otherwise do.

The suite is deliberately narrow: it keeps checks whose breakage is *silent* and skips
checks whose breakage already shouts. A malformed `plugin.json` fails loudly in Claude
Code and needs no test; a renamed auditor silently produces "no findings" forever and
needs one.

## Calibration

See [`fixtures/README.md`](fixtures/README.md). Calibration needs live agents and does
not run under `node --test`.
