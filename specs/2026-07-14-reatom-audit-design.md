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

`references/observed-misuse-cases.md` (a local-only field log of real production
misuse) states this precisely:

> All four cases share a shape: the author knew the right Reatom tool and used it
> elsewhere in the very same PR (`withConnectHook` for the `now` clock, `withAsync`
> for `startLogin`, loaders for routing) but reached for an imperative escape hatch
> at one specific spot.

The skill teaches before generation. Nothing checks after it. This design adds
that check.

## Investigation findings

These shaped the design and are recorded because they change what we build.

### 1. The handbook was replaced by an upstream dump (regression)

Commit `6fe6098` ("fix", 2026-07-05) deleted `references/reatomv1000.md` (1143
lines, curated) and added `references/llm.md` (574 lines, a raw
`llms.txt`-style export of the upstream Getting Started docs). `SKILL.md` was not
updated.

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
- `observed-misuse-cases.md` proposes edits to `llm.md` sections that only ever
  existed in `reatomv1000.md`, indicating the replacement was accidental.

**A/B test result (5 runs, one model, arms differing only in `llm.md` content):**
correctness was **identical** — the hypothesis that the dump breaks correctness
was **not confirmed**. Agents recover by reading `assets/reatom` source. But the
recovery is expensive and reproduced in every run:

| Scenario | Arm A (dump) | Arm B (handbook) |
| --- | --- | --- |
| Async list query | 5/5 · 24 tool calls | 5/5 · 15 tool calls |
| Hook orchestration | 5/5 · 15 tool calls | 5/5 · **5** tool calls |
| Page reset (`withComputed`) | pass · 20 calls · 272 s | pass · **5** calls · **92 s** |
| Atomization (control) | pass · 22 calls · 282 s | pass · 8 calls · 121 s |
| Polling (`withConnectHook`) | *no data — session limit* | pass · 6 calls |

Totals where both arms ran: **81 tool calls vs 33**. Both arms' agents
independently reported the `SKILL.md` ↔ `llm.md` mismatch unprompted.

Restoration is justified by cost and coherence, not by a proven correctness
regression. The polling scenario — the only one where arm A had zero in-skill
guidance, and the one matching a real production bug — remains untested.

### 2. The skill ships an answer key to its own evals

`evals/evals.json` prompts are **verbatim** the scenarios in
`references/test-scenarios.md`, which ships in `references/` and lists Expected
patterns and Failure signs for each. `baseline-results.md` adds the correct
patterns in prose. An agent reading them gets the answers.

This invalidated the first A/B run (both arms scored 10/10 by quoting
`test-scenarios.md`) and means the historical `with_skill = 1.0` (35/35) figure
cannot be read as evidence of real-task performance. Out of scope here; recorded
so the number is not trusted uncritically.

### 3. Repo and installed skill are separate, diverged copies

`C:\Users\Khmil\MySkills\reatom` (git) and `C:\Users\Khmil\.claude\skills\reatom`
(what agents read) are independent directory copies — not a symlink, not a
checkout. `SKILL.md` currently matches; `references/` does not:
`observed-misuse-cases.md` exists only in the installed copy and is unversioned.

Two implications for this design: fixes to the repo do not reach agents until
synced, and the field log can be destroyed by a re-sync.

## Decisions

| Question | Decision |
| --- | --- |
| Trigger | `Stop` hook in `~/.claude/settings.json` |
| Gate | Project-level: `@reatom/*` in any `package.json` |
| Scope | `merge-base(HEAD, main)..HEAD` + working tree; all changed `.ts`/`.tsx` |
| Auditors | 4 domain agents, read-only, dispatched in parallel |
| Findings | Block the stop; findings returned to the agent |
| Rules | Single registry: `references/rules.md` |
| Termination | Receipt keyed by content hash + max 3 iterations, fail-open |
| Manual entry | `/reatom-audit` slash command |

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

## Architecture

Three components; only one reasons about code.

```
Stop event
  │
  ▼
reatom-audit.sh  (deterministic, no LLM)
  ├─ not a Reatom project? ──────────────► exit 0, silent
  ├─ no changed .ts/.tsx? ───────────────► exit 0, silent
  ├─ hash == receipt.hash? ──────────────► exit 0, already audited
  ├─ iterations >= 3? ───────────────────► exit 0 + loud warning (fail-open)
  └─ otherwise ──────────────────────────► exit 2 + dispatch instructions
                                              │
                                              ▼
                              main agent dispatches 4 read-only auditors
                              (briefs: agents/audit-*.md, rules: references/rules.md)
                                              │
                                              ▼
                              findings → main agent fixes or dismisses
                                              │
                                              ▼
                              reatom-audit-receipt.sh  (writes hash + verdict)
                                              │
                                              ▼
                              next Stop → hash matches → exit 0
```

### Hook: `reatom-audit.sh`

Location: `~/.claude/hooks/reatom-audit.sh`. Runs under Git Bash (the Windows
default for hooks). Uses `$CLAUDE_PROJECT_DIR`.

Verified `Stop` hook mechanics:

- stdin JSON provides `session_id`, `transcript_path`, `cwd`, `permission_mode`,
  `hook_event_name`, `last_assistant_message`, `stop_reason`.
- `exit 2` blocks the stop and feeds **stderr** back to the model.
- `exit 0` with JSON on stdout supports `decision: "block"` + `reason`.
- `Stop` does **not** support matchers.
- **No built-in loop protection is documented.** `stop_hook_active` is not
  documented and must not be relied on. Loop termination is this design's
  responsibility.

Decision table:

| Condition | Action |
| --- | --- |
| Not a git repo | `exit 0` (fail-open) |
| No `@reatom/*` in any `package.json` | `exit 0`, silent |
| No changed `.ts`/`.tsx` in scope | `exit 0`, silent |
| Receipt hash == current hash | `exit 0` (this exact state is audited) |
| Iteration count >= 3 | `exit 0` + warning naming unresolved findings |
| Otherwise | increment counter; `exit 2` with dispatch instructions |

Scope excludes `node_modules`, `dist`, `build`, `*.d.ts`, and generated files.

### Termination

Naive blocking deadlocks the session: the agent fixes, tries to stop, the hook
audits again and blocks again, forever.

The receipt is keyed by the **content hash of the audited file set**, stored at
`.claude/reatom-audit/<session_id>.json` as
`{ audited_hash, verdict, iterations, dismissals[] }`.

- Agent fixes code → hash changes → the new code is honestly re-audited.
- Audit clean, no edits → hash unchanged → receipt matches → session ends.
- Agent forgets the receipt → hook blocks once more. Safe failure.

The hash is computed by `reatom-audit-receipt.sh`, never by the agent, so the
arithmetic cannot be fudged or fumbled.

**The 3-iteration cap is load-bearing.** A broken audit must never brick a
session. On exhaustion the hook passes and reports what stayed unfixed. The audit
may nag; it may not block work indefinitely.

### Rule registry: `references/rules.md`

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

`ref` points at the restored handbook (`references/llm.md`, see Step 0), matching
the section names `SKILL.md`'s Reference Map already promises.

`kind` has three values:

- **`reinvention`** — hand-rolls what the library provides (manual `setTimeout`
  debounce vs `await wrap(sleep(ms))`; manual `isLoading`/`error` atoms vs
  `withAsyncData`; bare `setInterval` vs `withConnectHook`; `useState` pending +
  `.finally()` vs `withAsync`).
- **`anti-pattern`** — does something forbidden (identity setters,
  `route.match()` branching, unwrapped async continuations).
- **`hygiene`** — unnamed units, eager atom reads before guards.

Seed the registry from: `SKILL.md` (`Default Decisions`, `Do Not Recommend`,
`Quick Reference`, `Validation Checklist`), the restored handbook, and the four
cases in `observed-misuse-cases.md`.

#### Keeping `SKILL.md` and the registry in sync

They serve different readers: `SKILL.md` is compact, for the **writing** agent;
`rules.md` is detailed, for the **checking** agent. Same content, different genre
— so they must not be one file, and must not drift.

Every `SKILL.md` bullet gets a rule tag, e.g.
`Local state updates: prefer direct atom.set (RTM-S01)`. A consistency check
asserts every ID in `SKILL.md` exists in `rules.md` and vice versa. No build step:
rules change monthly; a generator would not pay for itself.

### Domain auditors

Four fixed briefs in `agents/audit-*.md`. Each owns one rule group and reads the
whole changed set through that lens. Cost scales with domains, not files.

| Agent | Rules owned | Library inventory (for reinvention checks) |
| --- | --- | --- |
| `audit-async` | fetch mechanism, `wrap` boundaries, cancellation, debounce, sampling | `withAsyncData`, `withAsync`, `withAbort`, `wrap`, `sleep`, `onEvent` |
| `audit-state` | `atom.set` vs setter actions, atomization, dependent state | `atom.set`, `withComputed`, field atomization, model factories |
| `audit-lifecycle` | timers, subscriptions, listeners, connection-bound effects | `withConnectHook`, `withDisconnectHook`, `withChangeHook` |
| `audit-react-routing` | lazy reads, hook orchestration, routes, forms, persistence | `reatomComponent`, `reatomRoute` loader/render, `reatomField`, `withSearchParams`, `withLocalStorage` |

Naming hygiene is not a fifth agent; each auditor checks naming for the
constructs it owns.

Auditors are **read-only** (`Read`, `Grep`, `Glob`; no `Edit`). Four agents
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

#### Consistency check (from the field log's meta-observation)

Each auditor additionally greps the repo for **correct sibling usage** of the
tool it expects. "This file hand-rolls `setInterval`, while `add-device-model.ts`
binds its clock with `withConnectHook`" is a high-precision, low-argument signal
— it needs no appeal to doctrine, only to the codebase's own practice. This
targets the exact drift shape the field log identified.

### Calibration

This is where the design lives or dies. The main risk is not a missed violation —
it is crying wolf. Three false positives burn the iteration budget, and the user
disables the hook, landing back at the start.

An auditor reports a finding only if **all** hold: it names a `rule_id` from the
registry; it cites `file:line`; it names the exact replacement API; no `exception`
on that rule applies. Taste outside the registry is not a finding. "Could be more
idiomatic" is not a finding. No ID, no finding.

This deliberately trades recall for precision. An audit that catches 80% and never
lies beats one that catches 95% and lies every third time — the first stays
enabled.

### Dismissals

The registry cannot know every context, so the main agent must be able to reject a
finding — otherwise one false positive deadlocks the session. But free, silent
dismissal returns us to the original problem: an agent that "forgot" a rule will
just as happily "justify" ignoring it.

So dismissal costs something: it requires a written rationale, is recorded in the
receipt, and is **surfaced in the final user-visible message**:

```
Audit: 3 findings, 2 fixed, 1 dismissed
  RTM-S01 dismissed: setUser performs validation, not pass-through forwarding
```

Visibility is self-limiting — the user reads every dismissal and catches bad ones.
It also feeds `baseline-results.md`'s "Rationalizations Observed" section from
real work instead of from staged runs.

### Failure handling

If an auditor crashes or times out, the main agent reports partial results and
writes the receipt noting "domain X not audited". The hook cannot distinguish
"clean" from "could not run", and should not: its job is hashes and counters. A
failing audit degrades to silence, never to a block.

## Implementation order

**Step 0 — restore the handbook.** `git show 6fe6098^:references/reatomv1000.md`
→ `references/llm.md` (the name `SKILL.md` already expects). Move the current
upstream dump to `references/upstream-getting-started.md` and list it in the
Reference Map below the handbook, so its anti-pattern examples are never the first
thing an agent reads. Justified by 2.5× tool-call cost and a Reference Map that
currently lies. Independently valuable; do it first.

**Step 0.5 — resolve the copy divergence.** Decide whether
`~/.claude/skills/reatom` becomes a symlink/junction to the repo or a synced copy,
and version `observed-misuse-cases.md` (or deliberately keep it local and protect
it from re-sync). Without this, nothing below reaches agents.

**Step 1 — rule registry.** Write `references/rules.md`; tag `SKILL.md` bullets
with IDs; add the consistency check.

**Step 2 — hook.** `reatom-audit.sh` + `reatom-audit-receipt.sh` + the
`settings.json` entry. Test the decision table first — a hook that silently always
exits 0 looks perfectly healthy while doing nothing.

**Step 3 — auditors.** Four briefs in `agents/audit-*.md`.

**Step 4 — fixtures and calibration.** Then `/reatom-audit`.

## Testing

Three levels, each proportional to its risk.

**Hook logic** — a shell test over the decision table: no Reatom project → silent
`exit 0`; Reatom project, no receipt → `exit 2`; hash match → `exit 0`; iterations
exhausted → `exit 0` + warning; not a git repo → `exit 0`. This is where silent
breakage hides.

**Auditor calibration** — two fixture sets. `violations/` holds real bad code
from `baseline-results.md` and `observed-misuse-cases.md` (manual `setTimeout`
debounce, `canLoadAtom` enabled gates, `setUserFromLogin`, unwrapped `.then`, bare
`setInterval` poller, `useState` pending flag), each tagged with expected rule IDs.
`clean/` holds `golden-example.md`, which must yield **zero** findings.

The false-positive fixture matters more. A missed violation costs one violation; a
false positive costs trust in the system, and with it the hook.

**Registry consistency** — assert `SKILL.md` IDs and `rules.md` IDs match.

Note: audit fixtures must not repeat the eval mistake — auditors must not be able
to read the expected rule IDs from the fixture directory.

## Out of scope (YAGNI)

- Generating `SKILL.md` from the registry (rules change monthly).
- An ESLint plugin duplicating the audit (`assets/reatom` already ships one).
- Rule-coverage metrics.
- Running the audit in CI.
- Fixing the eval answer-key contamination (finding 2) — real, separate work.

## Risks

| Risk | Mitigation |
| --- | --- |
| False positives burn the budget and the hook gets disabled | Strict calibration; registry-ID requirement; visible dismissals |
| Main agent under-reports auditor findings | Fixed briefs in files; dismissals surfaced to the user; hash-keyed re-audit |
| Audit loop deadlocks a session | Hash-keyed receipt + 3-iteration cap + fail-open |
| Repo/installed divergence silently strands fixes | Step 0.5 before anything else |
| Large diffs make the audit expensive | Domain split caps cost at 4 agents regardless of file count |
| `stop_hook_active` semantics undocumented | Not relied upon; own counter instead |

## Open questions

- Sync mechanism between repo and `~/.claude/skills/reatom` (manual copy? script?)
  — determines Step 0.5.
- Should the polling A/B run be completed after the session limit resets, to close
  the one untested high-risk case?
