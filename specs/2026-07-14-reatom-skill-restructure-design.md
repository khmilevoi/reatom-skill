# Reatom plugin restructure for publication — design

**Date:** 2026-07-14
**Status:** approved
**Supersedes nothing.** Builds on `specs/2026-07-14-reatom-audit-design.md`, which designed the
audit layer this document keeps intact.

## Problem

The plugin cannot be published as it stands. Four defects, in descending order of severity.

**1. The bundled upstream repo does not exist for anyone but its author.**
`skills/reatom/assets/reatom` is committed as a gitlink (`160000 af2f81f4`) with no
`.gitmodules` registering a URL. Any clone gets an empty directory. `SKILL.md` points the
agent at `assets/reatom/...` in fifteen places, and every one of them resolves to nothing.

**2. `references/llm.md` is a silently drifting fork.**
It is a copy of upstream `skills/reatom/REFERENCE.md` — same title, same section order — with
two sections prepended. The two have diverged by 254 diff lines, and upstream is ahead on
points that matter:

| `references/llm.md` (ours) | upstream `REFERENCE.md` |
| --- | --- |
| `list.status()` is available | `.status()` is opt-in, requires `{ status: true }` |
| `submit.retry()` is available | on actions requires `withAsync({ cacheParams: true })`, else throws at call time |
| silent | `withChangeHook` does not fire when `set` throws — use `withErrorHook` |

The skill ships outdated API advice. Nothing detects this, because no test compares the fork
to its source.

**3. Runtime references and development artifacts are interleaved.**
`references/` holds both what the agent loads while working (`rules.md`, `golden-example.md`)
and skill-development records (`baseline-results.md`, `test-scenarios.md`,
`observed-misuse-cases.md`), plus `upstream-getting-started.md`, a stale dump that `SKILL.md`
itself warns teaches manual loading atoms.

**4. The repo is not a publishable unit.**
No `marketplace.json`, README, or LICENSE. Its tests live in the parent `MySkills` repo and
would be left behind. `.gitignore` is literally `docs\n/`, where `/` matches nothing.
`.claude/scheduled_tasks.lock` is tracked; `tools/` is empty.

## Goals

- The plugin works for someone who installs it and has never seen this repo.
- No hand-maintained fork of upstream content.
- One home per concern: shipped skill, vendored upstream, development-only.
- The audit layer (`rules.md`, five auditors, Stop gate, `/reatom-audit`) survives unchanged
  in behavior.

## Non-goals

- Changing audit rules, auditor briefs, or gate logic. Only paths and refs move.
- Upstreaming our additions to `reatom/reatom`. Recorded as optional follow-up; publication
  must not depend on someone else's review.
- Reworking `sync-skills.js` in the parent repo.

## Decisions

### D1 — Missing detail comes from the project's own `node_modules`

When the vendored handbook is insufficient, the agent reads the Reatom the project actually
installed, not a copy this plugin carries.

Verified against the published tarballs (`@reatom/core@1001.1.0`):

| Path | Size | Use |
| --- | --- | --- |
| `@reatom/core/dist/index.d.ts` | 7439 lines, 5065 of them JSDoc | authoritative API + prose |
| `@reatom/core/README.md` | 3730 bytes | install notes only — not the handbook |
| `@reatom/react/dist/index.d.ts` | 63 lines | thin; use the package README instead |
| `@reatom/react/README.md` | 16085 bytes | the real React adapter docs |
| `@reatom/jsx/dist/index.d.ts` | 3836 lines | substantial |
| `@reatom/jsx/README.md` | 20929 bytes | substantial |

`core/dist/index.d.ts` documents exactly what the fork got wrong (`cacheParams?: boolean` and
its `{@link withAsync}` prose). It is version-exact by construction.

Note for the implementer: an earlier assumption that `@reatom/core/README.md` is a symlink to
upstream `REFERENCE.md` and therefore ships the full handbook is **false** for published
1001.x. The symlink exists in the repo; the published README is the short one. Source Map
must cite `.d.ts` for core and READMEs for the adapters.

### D2 — Vendor upstream verbatim; keep only our delta

Upstream `reatom/reatom@v1001` ships four agent skills. We copy their reference bodies into
`skills/reatom/references/upstream/` and never hand-edit them. Our own material — the RTM rule
registry, the React decision guide, the atomization notes, the golden example — lives beside
them and cites them.

Division of labour: **upstream owns explanation, we own enforcement.** Upstream's
`reatom-review` skill already carries 25 named sections covering a superset of our registry in
prose (`### Identity Action`, `### Status Used Without Enabling It`, `### Async Extensions
Ordered After Cache`). What it has no notion of is stable ids, domain ownership, or a gate.
That is our layer, and it is what `rules.md` keeps.

### D3 — `rules.md` stays the single source of truth for defaults

`rules.md` declares itself so in its header: "`SKILL.md` is this file's compact projection:
every id below is tagged there, and the consistency test fails if the two drift."

That makes `llm.md`'s "Agent defaults and validation" section a third copy of the same
defaults, in prose, without RTM ids, already drifted. It is deleted, not relocated. There is
no `defaults.md`.

### D4 — The upstream clone is a development tool, not an asset

`assets/` in skill convention means "ships with the skill". Nothing ships from there any more.
The clone moves to `development/upstream/reatom/` and is gitignored; `development/sync-upstream.js`
copies from it into `references/upstream/`.

### D5 — Keep only the tests whose failure is silent

The plugin is markdown files bound to each other by string, with no compiler:

```
gate-logic.js   AUDITORS = ['audit-async', …]      string
agents/audit-async.md   name: audit-async          must match the filename
                        domain: async              must match
rules.md                - domain: async            the registry
                        - ref: <file>#<anchor>     must resolve to a live heading
```

Rename an auditor and the gate dispatches a name that does not exist; the audit silently does
not happen, and "no findings" is indistinguishable from "never ran".

Against that, the honest record: the existing 34 tests prevented none of the four defects
above. They checked what is easy to check. So the criterion is **keep the test when the
breakage is silent, drop it when the breakage already shouts.**

Applying it cuts less than expected. An earlier estimate in discussion said "~19 tests, cut to
~7"; both numbers were wrong, from miscounting `reatom-gate.test.js` as 3 tests when it holds
15. The suite is mostly load-bearing. The real cut is 34 → 24, and what goes is ceremony only.

## Target layout

```
reatom/
  .claude-plugin/
    marketplace.json          NEW  — the repo is installable on its own
    plugin.json               description corrected v1000 → v1001
  README.md                   NEW  — what it is, install, what the audit does
  LICENSE                     NEW  — MIT, ours
  NOTICE                      NEW  — upstream MIT attribution for references/upstream/
  package.json                NEW  — "test": "node --test development/tests"
  .gitignore                  rewritten

  skills/reatom/
    SKILL.md                  router: rules → upstream → node_modules
    references/
      rules.md                RTM-* registry — source of truth, refs remapped
      react-guide.md          ← llm.md §"React-to-Reatom decision guide" (lines 43–142)
      atomization-notes.md    ← llm.md additions absent upstream (see D6)
      golden-example.md       unchanged
      upstream/               VENDORED — do not edit
        core.md  async.md  jsx.md  review.md  VERSION

  agents/                     five auditors — unchanged
  hooks/                      hooks.json, reatom-gate.js, gate-logic.js — unchanged
  commands/reatom-audit.md    unchanged

  development/
    README.md                 how to work on this skill
    sync-upstream.js          clone → references/upstream/ + VERSION
    upstream/reatom/          GITIGNORED clone of reatom/reatom @ v1001
    fixtures/                 ← root fixtures/ (README.md, expected.json, violations/)
    scenarios.md              ← references/test-scenarios.md
    baseline-results.md       ← references/baseline-results.md
    misuse-cases.md           ← references/observed-misuse-cases.md
    tests/
      gate.test.js            gate logic + git-backed integration tests
      consistency.test.js     markdown string bindings

  specs/                      design docs (already tracked)
```

### D6 — What survives from `llm.md`

The fork is not purely behind upstream; it has content upstream lacks. These go to
`references/atomization-notes.md` rather than dying with the file:

- the O(1) argument for atomizing editable lists (changing `users()[idx].name` beats
  recreating the array and every intermediate object per keystroke)
- "do not atomize everything by default; make reactivity explicit where it buys local updates,
  subscriptions, validation, or effects"
- "backend DTOs stay plain at the boundary; application models atomize only what the UI mutates"

Optional follow-up, not a blocker: offer these upstream as a PR to `skills/reatom/REFERENCE.md`.

## Deletions

| Path | Reason |
| --- | --- |
| `skills/reatom/references/llm.md` | fork of upstream; split per D3/D6, API body ceded to `upstream/core.md` |
| `skills/reatom/references/upstream-getting-started.md` | stale dump; `SKILL.md` already warns it teaches manual loading atoms |
| `skills/reatom/evals/` | `evals.json` is non-discriminating by `fixtures/README.md`'s own admission — its prompts are verbatim copies of `test-scenarios.md`, which ships the expected patterns beside them |
| `skills/reatom/agents/openai.yaml` | Codex metadata in a Claude plugin, advertising `$reatom-v1000` |
| `skills/reatom/assets/` | gitlink removed via `git rm --cached`; clone moves per D4 |
| `.claude/scheduled_tasks.lock` | tracked scratch state |
| `tools/` | empty |

## Source access and precedence

`SKILL.md` states one order and one conflict rule:

```
1. references/rules.md        our defaults (RTM-*) — policy, binding
2. references/upstream/*.md   vendored handbook — explanation and recipes
3. node_modules/@reatom/*     version truth (see D1 for which file per package)
```

**Conflict rule.** When vendored `upstream/` and the installed `.d.ts` disagree, **the
installed `.d.ts` wins** — the project's code runs against it, not against our copy. The agent
compares `@reatom/core`'s version in the project's `package.json` against
`references/upstream/VERSION` and says so out loud when the major differs.

The absence of this rule is why the fork misinformed silently. `rules.md` defaults are policy,
not API claims, so they do not conflict with `.d.ts` and stay binding regardless.

When the project has no `node_modules/@reatom/*` (not installed, not a JS project), the agent
says the version could not be confirmed rather than guessing.

## Upstream vendoring

`development/sync-upstream.js` reads the gitignored clone and writes `references/upstream/`.

| Source in clone | Destination | Transform |
| --- | --- | --- |
| `skills/reatom/REFERENCE.md` | `upstream/core.md` | none |
| `skills/reatom-async/REFERENCE.md` | `upstream/async.md` | none |
| `skills/reatom-jsx/REFERENCE.md` | `upstream/jsx.md` | none |
| `skills/reatom-review/SKILL.md` | `upstream/review.md` | two, below |

"Verbatim" means **no hand edits**. The script applies exactly two declared, reproducible
transforms, both to `review.md` only:

1. `](../reatom/REFERENCE.md)` → `](./core.md)` — 3 occurrences. It is the only vendored file
   with relative links; the three `REFERENCE.md` files have none.
2. Its skill frontmatter (`name: reatom-review`, `description: …`) is replaced by the
   provenance header. Left intact, `references/` would contain a file declaring itself a skill
   it is not.

Every vendored file gets:

```html
<!-- VENDORED reatom/reatom@af2f81f4 (v1001) skills/reatom-review/SKILL.md
     DO NOT EDIT. Regenerate: node development/sync-upstream.js -->
```

`VERSION` records the upstream sha, branch, sync date, and a sha256 per source file.

Known limit, accepted: CI cannot prove "the committed output is what the script produces",
because the clone is gitignored. The test asserts each file in `upstream/` is listed in
`VERSION` and carries the header; re-running the script leaves a reviewable diff. That is the
achievable guarantee, and it is enough — the failure it must prevent is hand-editing, which
the header and the test make obvious.

`skills/README.md` from upstream is not vendored: it documents upstream's own symlink layout
and means nothing here.

## `rules.md` ref remapping

All 19 `ref:` fields currently point into `llm.md`, which is being deleted. Verified by literal
search: 12 of the 15 distinct anchors exist in upstream `core.md` unchanged; 3 are ours.

| Destination | Refs | Examples |
| --- | --- | --- |
| `upstream/core.md`, same anchor | 14 | `#withAsync`, `#Atomization`, `#**wrap** rules`, `#Lifecycle and extension hooks` |
| `react-guide.md` | 3 | `#React-to-Reatom decision guide` ×2, `#Before/after: enabled flags and async queries` |
| `upstream/review.md` | 2 | RTM-S01 → `#Identity Action`; RTM-S05 → `#Atom Factory Named Like A Getter` |

The two `upstream/review.md` targets are the rules whose refs pointed at `llm.md#Agent defaults
and validation`, the section D3 deletes.

## Tests

Migrate from `MySkills/tests/reatom-*.test.js` into `development/tests/`, fixing `ROOT` (was
`__dirname/..` plus a `reatom` segment; becomes `__dirname/../..`).

Two files, split by subject:

- `gate.test.js` — the gate's executable logic, including its git-backed integration tests
- `consistency.test.js` — the markdown string bindings

This deviates from the "one file" sketch agreed in discussion. Reason: the gate tests exercise
real code end-to-end and are not consistency checks; filing them under `consistency.test.js`
would misname the most important tests in the repo. Flagged here for the spec review.

**Kept — the breakage is silent (24):**

| Test(s) | Count | What silently breaks without it |
| --- | --- | --- |
| all of `reatom-gate.test.js` | 15 | The Stop gate blocks the user's session. A bug either wedges the session shut or skips the audit while looking fine. Eight are integration tests over real git repos covering the marker, branch commits, non-git dirs, and re-block on new changes. This is the highest-stakes code in the repo and its only executable logic. |
| `the gate dispatches exactly the auditors that exist` | 1 | renamed auditor → no audit, reported as "no findings" |
| `hooks.json registers the Stop gate through the plugin root` | 1 | wrong path → the hook never runs, silently |
| `every auditor is read-only, named, and points at the registry` | 1 | an auditor granted `Edit`/`Write` starts changing code it is meant only to report on |
| `every registry rule is owned by exactly one auditor domain` | 1 | `domain: routing` instead of `routing-forms` → the rule belongs to nobody and is quietly disabled |
| `every rule has a unique id, a known domain and a known kind` | 1 | same class: malformed registry entries stop being enforced |
| `every rule ref resolves` (**generalized**) | 1 | broken ref → the auditor cannot cite the rule it reports |
| `SKILL.md and rules.md reference exactly the same rule ids` | 1 | keeps `rules.md`'s stated projection contract honest |
| `handbook contains every section the Reference Map promises` (**rewritten**) | 1 | same class of silent binding as the ref test |
| upstream files listed in `VERSION` and carry the header (**new**) | 1 | a hand-edited vendor drifts back into a fork — defect 2, the one nothing caught |

The ref test is generalized, not invented. It exists at `tests/reatom-skill.test.js:89` and is
weak in two ways: it hardcodes `/^- ref: llm\.md#(.+)$/` (so after the move it fails loudly on
`refs.length >= 10` rather than rotting), and it checks anchors with `handbook.includes(r)` —
a substring match anywhere in the file, not a heading. The replacement resolves `file#anchor`
across `upstream/core.md`, `upstream/review.md`, and `react-guide.md`, and asserts the anchor
is a real heading.

**Dropped — the breakage already shouts (10):**

| Test | Why |
| --- | --- |
| `plugin.json declares name/description/version` | malformed plugin.json fails loudly in Claude Code |
| `marketplace.json lists reatom and its source resolves to a plugin dir` | same |
| `the skill sits under skills/reatom with its references and assets` | checks files exist; also asserts `assets`, which is gone |
| `reatom-audit command has frontmatter and dispatches the auditors` | the auditor-name binding is already covered by the gate dispatch test |
| `every violation fixture expects at least one real rule id` | calibration is run by hand per `fixtures/README.md` |
| `fixtures do not leak the expected rule ids to the auditors` | same |
| `the clean fixture is the golden example and expects zero findings` | same |
| `handbook carries the agent defaults block` | the section is deleted (D3) |
| `handbook does not teach the manual loading-atom anti-pattern` | guarded a leak into `llm.md`; there is no `llm.md` |
| `the upstream dump is kept, demoted, and listed below the handbook` | the dump is deleted |

Net: **34 → 24.** What goes is ceremony; nothing that guards a silent failure is cut.

**Stays in `MySkills`:** `sync config points reatom at the plugin skill subpath` — it asserts
the parent's `sync-skills.config.json`, not this plugin.

## Licensing

Upstream is `MIT, Copyright (c) 2019-present Artyom Arutyunyan`. Vendoring ~148 KB of it is
permitted with the copyright preserved, so:

- `LICENSE` — MIT for our work (auditors, gate, registry, guides)
- `NOTICE` — upstream's full MIT text, plus a statement that
  `skills/reatom/references/upstream/` is copied from `reatom/reatom@<sha>`, with a link

## `.gitignore`

```
development/upstream/
docs/
node_modules/
```

Replaces `docs\n/`, whose `/` line matches nothing and whose intent was `docs/`. Design docs
live in tracked `specs/`; `docs/` remains superpowers scratch. Also `git rm --cached
.claude/scheduled_tasks.lock`.

## Parent repository (`MySkills`)

`reatom/` becomes a **submodule** of `MySkills`, properly registered in `.gitmodules`.

The alternative — gitignoring it — was rejected on a consequence worth stating: `reatom` is the
*only* entry in `sync-skills.config.json`, so ignoring it leaves the parent's sync tooling with
no consumer, and leaves `marketplace.json` pointing at `./reatom`, which a fresh clone would
not have. As a submodule, the marketplace entry, the Codex sync into `.codex/skills/reatom`,
and the one remaining test all keep working, while `reatom` publishes independently.

This does re-introduce a submodule right after we removed one. The difference is that this one
is registered and reproducible; the old gitlink was neither.

## Machine cleanup (outside the repo)

Not code, but the same inconsistency this work exists to fix:

- `~/.claude/skills/reatom/` — a stale copy of the skill (SKILL.md 6597 bytes, 21 Jun, against
  the current 7757, 14 Jul) with its own `assets/`. It is why this session lists both `reatom`
  and `reatom:reatom`. `MySkills/AGENTS.md` already forbids it: "Do not add a plugin's skill
  back into `.claude/skills`." Delete.
- `~/.agents/skills/reatom` — orphaned; `sync-skills.config.json` targets only `.codex`. Delete.
- `~/.codex/skills/reatom` — legitimate, keep.

## Risks

**Skill name collision.** Upstream ships a skill named `reatom` installable via
`npx skills add reatom/reatom`; ours is also `reatom`. A user with both gets two. Accepted:
Claude Code namespaces plugin skills (`reatom:reatom`), and the collision only bites the
non-plugin install paths. Revisit if it surfaces in practice.

**Vendor staleness.** `references/upstream/` is a point-in-time copy. Mitigated, not solved, by
`VERSION` plus the D1 precedence rule that lets the installed `.d.ts` overrule it. Re-sync is a
one-command chore, and its diff is the review.

**Fixture calibration stays manual.** Cutting the fixture-shape tests means nothing mechanical
guards the corpus. `fixtures/README.md` already states calibration needs live agents and cannot
run under `node --test`, so this changes the honesty of the test suite, not its real coverage.

## Verification

1. `node --test development/tests` passes.
2. `git clone` into a fresh directory contains no empty `assets/`, and every path
   `SKILL.md` cites either exists in the clone or is explicitly a `node_modules` lookup.
3. `grep -rn "llm.md\|assets/reatom\|upstream-getting-started" skills/ agents/ commands/ hooks/`
   returns nothing.
4. Every `ref:` in `rules.md` resolves — asserted by the generalized test, not by eye.
5. Install from the repo's own marketplace into a scratch project and confirm the Stop gate
   fires on a changed `.ts` file and dispatches all five auditors.
