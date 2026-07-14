---
title: 'Post-implementation audit for the Reatom skill'
date: 2026-07-14
status: design
---

# Post-Implementation Audit for the Reatom Skill

## Problem

When an agent implements a feature, it does not reliably follow the skill's rules.
The dominant failure is not ignorance and not sabotage — it is **attention drift
during generation**. The agent knows the right Reatom tool, uses it correctly in
one place, and hand-rolls a substitute for the next one.

`references/observed-misuse-cases.md` (a field log of real production misuse)
states this precisely:

> All four cases share a shape: the author knew the right Reatom tool and used it
> elsewhere in the very same PR (`withConnectHook` for the `now` clock, `withAsync`
> for `startLogin`, loaders for routing) but reached for an imperative escape hatch
> at one specific spot.

The skill teaches before generation. Nothing checks after it. This design adds
that check, shipped as a plugin in the `khmil-local` marketplace.

## Investigation findings

These shaped the design and are recorded because they changed what we build.

### 1. The handbook was replaced by an upstream dump (regression)

Commit `6fe6098` ("fix", 2026-07-05) deleted `references/reatomv1000.md` (1143
lines, curated) and added `references/llm.md` (574 lines, a raw `llms.txt`-style
export of the upstream Getting Started docs). `SKILL.md` was not updated.

Consequences:

- `SKILL.md`'s Reference Map promises 17 sections (`wrap rules`,
  `React-to-Reatom decision guide`, `Atomization`, `Lifecycle and extension
  hooks`, …). **None exist** in `llm.md`.
- The section `Agent defaults and validation` — the enforcement core — is gone.
- `llm.md` actively demonstrates a forbidden pattern: a paginated list load with
  a manual `isListLoading` atom and an unwrapped `fetch` (`isListLoading` appears
  4×), which `SKILL.md` lists under **Avoid**.
- Rule coverage lost (mentions in file): `withConnectHook` 7 → **0**;
  `withAbort` 12 → **0**; `withComputed` 12 → 2; `withAsyncData` 19 → 8.

**A/B test (5 runs, one model, arms differing only in `llm.md` content):**
correctness was **identical** — the hypothesis that the dump breaks correctness
was **not confirmed**. Agents recover by reading `assets/reatom` source. The
recovery is expensive, and that reproduced in every run:

| Scenario | Arm A (dump) | Arm B (handbook) |
| --- | --- | --- |
| Async list query | 5/5 · 24 tool calls | 5/5 · 15 tool calls |
| Hook orchestration | 5/5 · 15 tool calls | 5/5 · **5** tool calls |
| Page reset (`withComputed`) | pass · 20 calls · 272 s | pass · **5** calls · **92 s** |
| Atomization (control) | pass · 22 calls · 282 s | pass · 8 calls · 121 s |
| Polling (`withConnectHook`) | *no data — session limit* | pass · 6 calls |

Totals where both arms ran: **81 tool calls vs 33**. Both arms' agents reported
the `SKILL.md` ↔ `llm.md` mismatch unprompted.

Restoration is justified by cost and coherence, not by a proven correctness
regression. The polling scenario — the only one where arm A had zero in-skill
guidance, and the one matching a real production bug — remains untested.

### 2. The skill ships an answer key to its own evals

`evals/evals.json` prompts are **verbatim** the scenarios in
`references/test-scenarios.md`, which ships in `references/` and lists Expected
patterns and Failure signs for each. `baseline-results.md` adds the correct
patterns in prose.

This invalidated the first A/B run (both arms scored 10/10 by quoting
`test-scenarios.md`) and means the historical `with_skill = 1.0` (35/35) figure
cannot be read as evidence of real-task performance. Out of scope here; recorded
so the number is not trusted uncritically.

### 3. `sync-skills.js` is a mirror sync, and the field log was unprotected

`sync-skills.js` resolves each source from the skill-name key
(`sourceRoot = resolveWorkspacePath(skillName, workspaceRoot)`), requires
`SKILL.md` at that root, and **prunes** target files absent from the source.
`observed-misuse-cases.md` existed only in `~/.claude/skills/reatom` — the next
`--apply` would have deleted it. It has been copied into `reatom/references/` and
deliberately left untracked.

This also fixes the copy-divergence concern: there is one source of truth
(`MySkills/reatom`) fanned out to `.claude`, `.codex`, and `.agents`.

### 4. The `architecture` plugin already solves most of this

`MySkills` is a marketplace (`.claude-plugin/marketplace.json`, `khmil-local`)
with one registered plugin, `architecture`, which is the same shape as what we
need and establishes the conventions to follow:

- Hook ships **inside the plugin**: `hooks/hooks.json` with
  `node "${CLAUDE_PLUGIN_ROOT}/hooks/architecture-gate.js"`, `timeout: 120`. No
  `settings.json` editing.
- **Node CommonJS**, no semicolons — not shell. Cross-platform by default.
- Pure logic split into `hooks/gate-logic.js` (`computeMarker`,
  `proceedToModel`, `postGateDecision`), covered by `node --test` in `tests/`.
- Blocks via `{"decision":"block","reason":…}` on stdout, not `exit 2`.
- Loop protection uses **`stop_hook_active`** from the hook's stdin.
- Marker file in `.git/` keyed by `sha256(sorted changed files + HEAD sha)`.
- Fail-open throughout ("marker is only an optimization").

Two corrections to an earlier draft of this design follow from that: the
`stop_hook_active` field **does** exist and is the loop guard (a bespoke
iteration counter would have been exactly the kind of reinvention this audit is
meant to catch), and the hook must not live in `~/.claude/settings.json`.

## Decisions

| Question | Decision |
| --- | --- |
| Distribution | Plugin `reatom` in the `khmil-local` marketplace |
| Trigger | `Stop` hook shipped in `hooks/hooks.json` |
| Gate | Mechanical: `@reatom/*` in any `package.json` + changed `.ts`/`.tsx` |
| Scope | `merge-base(HEAD, main)..HEAD` + working tree |
| Auditors | 5 domain agents (4 core + 1 adapter), read-only, parallel |
| Findings | Block the stop; findings returned to the agent |
| Rules | Single registry: `references/rules.md` |
| Loop guard | `stop_hook_active` + `.git/` marker |
| Manual entry | `/reatom-audit` command |
| Language | Node CommonJS, mirroring `architecture` |

### Why a hook, not a `SKILL.md` instruction

An instruction to "run the audit after implementing" is subject to the same drift
it is meant to catch. The harness executes hooks; the agent cannot decline. Fixed
auditor briefs live in files, so audit *content* is not at the main agent's
discretion either — it is only the courier.

### Why the gate is project-level, not per-file

A per-file filter ("does this file import `@reatom/*`?") is systematically blind
to the primary target. Code that hand-rolls a substitute for a library tool **does
not import the library** — a component with `useState` + `useEffect` + a manual
`isLoading` has no Reatom import precisely because it failed to use Reatom. The
filter would skip the file exactly when it is most wrong. It also misses
components importing only a local model, and projects re-exporting Reatom through
a local barrel.

Cost is preserved: a non-Reatom project exits silently; a Reatom project with no
changed `.ts`/`.tsx` exits silently.

Unlike `architecture`, this gate needs **no cheap model call**. "Is this a Reatom
project with changed TypeScript?" is mechanical. `architecture` must ask a model
whether a change plausibly affects what its docs describe; we do not.

## Plugin layout

Mirrors `architecture`:

```
reatom/
  .claude-plugin/plugin.json        { name: "reatom", version, description }
  skills/
    reatom/
      SKILL.md                      the skill entrypoint (moved from root)
      references/                   llm.md, rules.md, golden-example.md, …
      assets/reatom                 upstream submodule
      evals/
  agents/
    audit-async.md
    audit-state.md
    audit-lifecycle.md
    audit-routing-forms.md
    audit-react.md
  hooks/
    hooks.json
    reatom-gate.js                  I/O, git, stdin
    gate-logic.js                   pure, unit-tested
  commands/
    reatom-audit.md                 manual entry point
```

Registered in `.claude-plugin/marketplace.json` alongside `architecture`.

**`sync-skills.js` change.** It currently derives the source from the skill key
and demands `<skillName>/SKILL.md`, which the plugin layout breaks. Add an
optional per-skill `source`:

```json
"skills": {
  "reatom": {
    "source": "reatom/skills/reatom",
    "targets": ["C:/Users/Khmil/.agents/skills/reatom", "…"]
  }
}
```

Keep the array form working for existing entries. Codex and `.agents` keep
receiving a plain skill directory; Claude Code gets the plugin. Extend
`tests/sync-skills.test.js` for both config shapes.

## Hook

`hooks/hooks.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/reatom-gate.js\"",
            "timeout": 120
          }
        ]
      }
    ]
  }
}
```

`Stop` supports no matchers, so the gate must self-filter cheaply.

Decision table (pure, in `gate-logic.js`):

| Condition | Action |
| --- | --- |
| `stop_hook_active` | allow — we are already inside a hook-triggered continuation |
| Not a git repo | allow (fail-open) |
| No `@reatom/*` in any `package.json` | allow, silent |
| No changed `.ts`/`.tsx` in scope | allow, silent |
| `marker === lastMarker` | allow — this exact state was audited |
| Otherwise | block with dispatch instructions; write marker |

Scope excludes `node_modules`, `dist`, `build`, `*.d.ts`, and generated files.

### Scope: why it differs from `architecture`

`architecture` looks at `git diff --name-only HEAD` plus untracked files — that is,
uncommitted work only. Agents frequently commit mid-session, and those changes
would then be invisible. We use `merge-base(HEAD, main)..HEAD` plus the working
tree, falling back to `git diff HEAD` when no `main` exists. Re-scanning the whole
branch is affordable because the marker means the audit only runs when the set
actually changed.

### Loop termination

Naive blocking deadlocks the session: the agent fixes, tries to stop, the hook
audits again and blocks again, forever. Two mechanisms, both borrowed:

- **`stop_hook_active`** — true when the stop was already triggered through a
  hook. The gate returns "allow" immediately. This bounds any single chain.
- **Marker** — `sha256(sorted changed file paths + HEAD sha)` in
  `.git/reatom-audit-last`. Once a state is audited, it is not re-audited.

Fail-open everywhere: marker write failures, git failures, and a missing `main`
all degrade to "allow". A broken audit must never brick a session — it may nag,
never block indefinitely.

## Rule registry: `references/rules.md`

One entry per rule, machine- and human-readable:

```markdown
### RTM-A01 — Async reads use computed + withAsyncData
- domain: async
- kind: reinvention
- bad: `useEffect(() => { fetch(url).then(setData) }, [])`
- good: `computed(async () => wrap(fetch(url))).extend(withAsyncData({ initState: [] }))`
- detect: useEffect/effect whose body fetches idempotent read data
- exception: non-idempotent one-shot on user gesture → action + withAsync
- ref: llm.md#withAsync
```

`ref` points at the restored handbook (`references/llm.md`, Step 0), matching the
section names `SKILL.md`'s Reference Map already promises.

`kind` has three values:

- **`reinvention`** — hand-rolls what the library provides (manual `setTimeout`
  debounce vs `await wrap(sleep(ms))`; manual `isLoading`/`error` atoms vs
  `withAsyncData`; bare `setInterval` vs `withConnectHook`; `useState` pending +
  `.finally()` vs `withAsync`). This is the primary target.
- **`anti-pattern`** — does something forbidden (identity setters,
  `route.match()` branching, unwrapped async continuations).
- **`hygiene`** — unnamed units, eager atom reads before guards.

Seed from `SKILL.md` (`Default Decisions`, `Do Not Recommend`, `Quick Reference`,
`Validation Checklist`), the restored handbook, and the four cases in
`observed-misuse-cases.md`.

### Keeping `SKILL.md` and the registry in sync

They serve different readers: `SKILL.md` is compact, for the **writing** agent;
`rules.md` is detailed, for the **checking** agent. Same content, different genre
— so they must not be one file, and must not drift.

Every `SKILL.md` bullet gets a rule tag, e.g.
`Local state updates: prefer direct atom.set (RTM-S01)`. A consistency test
asserts every ID in `SKILL.md` exists in `rules.md` and vice versa. No build step:
rules change monthly; a generator would not pay for itself.

## Domain auditors

Five fixed briefs in `agents/audit-*.md`. Each owns one rule group and reads the
whole changed set through that lens. Cost scales with domains, not files.

The split mirrors the library's own architecture. Reatom is framework-agnostic:
`reatomRoute` lives in `packages/core/src/routing`, forms in `core/src/form`,
persistence in `core/src/persist`, and rendering is an abstraction
(`core/src/reatomAbstractRender.ts`) that nine adapters implement (`react`, `vue`,
`solid-js`, `lit`, `preact`, `jsx`, …). The React adapter is a thin layer —
`reatomComponent.ts`, `hooks.ts`, `bindField.ts`, `reatomFactoryComponent.ts` —
and does not re-export routing.

| Agent | Rules owned | Library inventory (for reinvention checks) | Source |
| --- | --- | --- | --- |
| `audit-async` | fetch mechanism, `wrap` boundaries, cancellation, debounce, sampling | `withAsyncData`, `withAsync`, `withAbort`, `wrap`, `sleep`, `onEvent` | `core/src/{async,methods}` |
| `audit-state` | `atom.set` vs setter actions, atomization, dependent writable state | `atom.set`, `withComputed`, field atomization, model factories | `core/src/{core,primitives,extensions}` |
| `audit-lifecycle` | timers, subscriptions, listeners, connection-bound side effects | `withConnectHook`, `withDisconnectHook`, `withChangeHook` | `core/src/extensions` |
| `audit-routing-forms` | route data lifetime, forms, persistence, URL state | `reatomRoute` loader/render/outlet, `reatomField`, `reatomForm`, `withSearchParams`, `withLocalStorage` | `core/src/{routing,form,persist}` |
| `audit-react` | lazy atom reads, hook orchestration, component boundaries | `reatomComponent`, collapsing hooks into `computed` | `packages/react` |

**Only `audit-react` is adapter-bound.** The other four audit framework-agnostic
core usage and are unaffected by the view layer, so the adapter auditor is a slot:
a Vue or Solid project swaps it and keeps the rest. Which brief runs is chosen
from the installed `@reatom/<adapter>` package; only React is implemented now.

Naming hygiene is not a sixth agent; each auditor checks naming for the
constructs it owns.

Auditors are **read-only** (`Read`, `Grep`, `Glob`; no `Edit`). Five agents
editing one file in parallel would collide, and an auditor that fixes its own
findings has an incentive to find them. The main agent applies fixes.

Finding format:

```
rule_id: RTM-A01
file: src/features/users/model.ts
line: 14
found: manual isLoadingAtom + errorAtom around fetch
instead: computed(async).extend(withAsyncData({ initState: [] }))
```

### Consistency check

Each auditor additionally greps the repo for **correct sibling usage** of the tool
it expects. "This file hand-rolls `setInterval`, while `add-device-model.ts` binds
its clock with `withConnectHook`" is a high-precision, low-argument signal — it
appeals to the codebase's own practice, not to doctrine. This targets the exact
drift shape the field log identified.

## Calibration

This is where the design lives or dies. The main risk is not a missed violation —
it is crying wolf. A few false positives and the plugin gets uninstalled, landing
us back at the start.

An auditor reports a finding only if **all** hold: it names a `rule_id` from the
registry; it cites `file:line`; it names the exact replacement API; no `exception`
on that rule applies. Taste outside the registry is not a finding. "Could be more
idiomatic" is not a finding. No ID, no finding.

This deliberately trades recall for precision. An audit that catches 80% and never
lies beats one that catches 95% and lies every third time — the first stays
installed.

## Dismissals

The registry cannot know every context, so the main agent must be able to reject a
finding — otherwise one false positive deadlocks the session. But free, silent
dismissal returns us to the original problem: an agent that "forgot" a rule will
just as happily "justify" ignoring it.

So dismissal costs something: it requires a written rationale and is **surfaced in
the final user-visible message**:

```
Audit: 3 findings, 2 fixed, 1 dismissed
  RTM-S01 dismissed: setUser performs validation, not pass-through forwarding
```

Visibility is self-limiting — the user reads every dismissal and catches bad ones.
It also feeds `observed-misuse-cases.md` and `baseline-results.md` from real work
instead of staged runs.

## Failure handling

If an auditor crashes or times out, the main agent reports partial results and
notes which domain went unaudited. The gate cannot distinguish "clean" from "could
not run", and should not: its job is markers and filters. A failing audit degrades
to silence, never to a block.

## Implementation order

**Step 0 — restore the handbook.** `git show 6fe6098^:references/reatomv1000.md`
→ `references/llm.md` (the name `SKILL.md` already expects). Move the current
upstream dump to `references/upstream-getting-started.md`, listed in the Reference
Map below the handbook so its anti-pattern examples are never read first.
Justified by 2.5× tool-call cost and a Reference Map that currently lies.
Independently valuable; do it first.

**Step 1 — plugin restructure.** Move the skill under `skills/reatom/`, add
`.claude-plugin/plugin.json`, register in `marketplace.json`, teach
`sync-skills.js` the optional `source` field, extend its tests. Verify Codex and
`.agents` still receive a plain skill.

**Step 2 — rule registry.** Write `references/rules.md`; tag `SKILL.md` bullets
with IDs; add the consistency test.

**Step 3 — gate.** `hooks/gate-logic.js` + `hooks/reatom-gate.js` +
`hooks/hooks.json`. Test the decision table first — a gate that silently always
allows looks perfectly healthy while doing nothing.

**Step 4 — auditors.** Five briefs in `agents/`.

**Step 5 — fixtures and calibration.** Then `commands/reatom-audit.md`.

## Testing

`node --test` in root `tests/`, matching the existing convention.

**Gate logic** — `tests/reatom-gate.test.js` over the decision table:
`stop_hook_active` → allow; non-Reatom project → allow; no changed `.ts`/`.tsx` →
allow; marker match → allow; otherwise → block; not a git repo → allow. This is
where silent breakage hides.

**Plugin wiring** — `tests/reatom-plugin.test.js`, mirroring
`architecture-plugin.test.js`: manifest valid, `hooks.json` well-formed, agent and
command files present.

**Auditor calibration** — two fixture sets. `violations/` holds real bad code from
`baseline-results.md` and `observed-misuse-cases.md` (manual `setTimeout` debounce,
`canLoadAtom` enabled gates, `setUserFromLogin`, unwrapped `.then`, bare
`setInterval` poller, `useState` pending flag), each tagged with expected rule IDs.
`clean/` holds `golden-example.md`, which must yield **zero** findings.

The false-positive fixture matters more. A missed violation costs one violation; a
false positive costs trust, and with it the plugin.

**Registry consistency** — assert `SKILL.md` IDs and `rules.md` IDs match.

Fixtures must not repeat the eval mistake: auditors must not be able to read
expected rule IDs from the fixture directory.

## Out of scope (YAGNI)

- Generating `SKILL.md` from the registry (rules change monthly).
- An ESLint plugin duplicating the audit (`assets/reatom` already ships one).
- A cheap-model triage gate (`architecture` needs one; our gate is mechanical).
- Rule-coverage metrics; running the audit in CI.
- Fixing the eval answer-key contamination (finding 2) — real, separate work.

## Risks

| Risk | Mitigation |
| --- | --- |
| False positives burn trust and the plugin gets uninstalled | Strict calibration; registry-ID requirement; visible dismissals |
| Main agent under-reports auditor findings | Fixed briefs in files; dismissals surfaced to the user |
| Audit loop deadlocks a session | `stop_hook_active` + marker + fail-open |
| Plugin restructure breaks Codex/`.agents` sync | `source` field + extended `sync-skills` tests before cutover |
| Large diffs make the audit expensive | Domain split caps cost at 5 agents regardless of file count |
| Field log lost to a mirror sync | Copied into `reatom/references/`, deliberately untracked |

## Open questions

- Complete the polling A/B run once the session limit resets, to close the one
  untested high-risk case (`withConnectHook`, zero coverage in the dump, and a
  real production bug)?
- `observed-misuse-cases.md` is untracked but not ignored, so it will show as
  untracked in `git status` indefinitely. Add a `.gitignore` entry (matching its
  own "Gitignored, local-only" header), or leave it visible as a reminder?
