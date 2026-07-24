# Changelog

## 0.5.0

A consultation-only session — one that answered questions and never invoked
a tool that could touch the working tree — still got blocked on changes made
outside it, and the block wrote the cache, permanently marking those changes
as asked-about after being seen once by a session that had nothing to do
with them. And when a session genuinely could not tell whether its tools
touched a file, the triage silently spent audit tokens instead of asking the
one party who knows.

### Added

- **Consultation-session skip.** Before blocking, the Stop gate scans the
  session transcript (`transcript_path`) against an allowlist of provably
  read-only tools (Read, Grep, Glob, WebSearch, WebFetch, TodoWrite,
  AskUserQuestion, ToolSearch, EnterPlanMode, ExitPlanMode, TaskCreate,
  TaskGet, TaskList, TaskOutput, TaskStop, TaskUpdate). If the session never
  invoked anything else, the diff cannot be its work: the gate allows
  silently, leaves the cache untouched — the changes resurface at the next
  Stop of a session that did mutate something — and tells the operator in a
  one-line systemMessage which files were left unaudited. Everything is
  fail-closed: Bash, Task, Skill, MCP tools, unknown names, a malformed
  transcript line, a transcript with no recognizable entries, or a missing
  transcript all count as mutating and keep the blocking behavior.
- **Confidence triage in the block reason.** The triage protocol now has
  three outcomes instead of two: changed by this session → audit; certainly
  not changed → skip and report (unchanged from 0.4.0); genuinely unsure →
  ask the operator one AskUserQuestion naming all unsure files, with
  "Audit (recommended)" and "Skip" options, falling back to auditing when
  asking is impossible.

## 0.4.0

The gate routed every changed file to auditors no matter who changed it or
what the file was. A session that only answered questions still got blocked
on working-tree changes made outside it, and paths that are not audit
surface at all — test fixtures, scanner code that treats Reatom tokens as
data — were re-routed on every content change with no way to exclude them.

### Added

- **`.reatom-gate-ignore`** — a gitignore-style file at the project root
  (one glob per line, `#` comments, a missing file is a no-op) whose matches
  the Stop gate drops before routing. Supports `*` and `?` within a segment,
  `**` across segments, root-anchoring by any slash, and a trailing `/` for
  everything under a directory; negation is deliberately unsupported. The
  file is operator-maintained — the plugin never writes to it. `/reatom-audit`
  deliberately does not apply it: an explicit manual invocation must still
  reach ignored paths.
- **Session-context triage in the block reason.** Before dispatching, the
  receiving session now judges each listed file from its conversation
  context alone — without inspecting the files — and skips the ones it did
  not change, reporting every skip to the operator with the available
  follow-ups (`/reatom-audit <paths>`, or an ignore entry). Unsure fails
  toward auditing. This is a text-only change: the hook's
  `{decision, reason}` contract and caching are unchanged — which also
  means a skip is final until the file's content changes again, and the
  mandatory operator note is the safety valve.

## 0.3.1

The Stop gate found committed branch work with `git merge-base HEAD main`, a
literal branch name. On any repo whose default branch isn't `main` — `master`,
`develop`, `trunk`, anything else — that command failed, `changedFiles`
silently fell back to the working tree only, and committed work went
unaudited with no signal that anything was skipped.

### Fixed

- **Base branch is now detected, not assumed.** The gate resolves it through
  `origin/HEAD` (read locally, never over the network), then the conventional
  names `main`/`master`/`develop`/`trunk`, then a commit-graph heuristic (the
  branch HEAD most recently diverged from) as a last resort. An undetectable
  base branch still fails open to working-tree-only auditing, exactly as
  before — never a crash, never a block.
- **The answer is pinned to `.git/reatom-base-branch`** so detection runs
  once. A value the operator writes by hand is trusted forever — the
  mechanism for correcting a wrong guess. A value the gate wrote itself is
  marked internally and gets a cheap recheck on every run, so a base branch
  that shows up later (someone creates `main`, or configures `origin/HEAD`)
  is picked up automatically instead of the guess sticking forever.
- **A guessed or undetectable base branch now surfaces a one-time warning**
  via the hook's `systemMessage` field, naming the pin file so the operator
  (or an agent acting for them) knows where to correct it.
- `commands/reatom-audit.md` documents the detected scope instead of the old
  hardcoded `merge-base(HEAD, main)`.

## 0.3.0

Upstream sync to [`reatom/reatom@06a7f7a1`](https://github.com/reatom/reatom/tree/v1001)
(54 commits ahead of the previous pin), and the registry grows from 19 rules to 26.

Most of this release is **corrections**. The audit was flagging code that upstream's own
handbook and examples recommend, and a rule that fires on correct code costs more than a
rule that misses one.

### Fixed — rules that flagged correct code

- **RTM-L02 no longer forbids `effect` outright.** It carried `exception: none` while
  upstream documents `effect` owning a polling loop inside an abortable scope, and ships
  `withFormAutoSubmit` built on exactly that shape. RTM-L01 justified the ban with a claim
  the source contradicts — `effect` is extended with `withAbort()` and
  `withDynamicSubscription()`, and does unsubscribe on abort. Both rules are reframed around
  *who can abort this* rather than *which primitive it uses*. A bare module-level `effect`
  owning a resource is still a violation, because nothing stops that one.
- **RTM-C01 no longer tells you to break the Rules of Hooks.** It prescribed moving atom
  reads below early-return guards and listed `useAtom` as a trigger, but `useAtom` calls
  `useMemo` and `useSyncExternalStore` unconditionally. The rule is now scoped to
  `reatomComponent`, with an explicit carve-out for genuine hooks.
- **Seven rules gained exceptions** for shapes upstream's own examples use: a `URL` or
  `URLSearchParams` built for an outbound request (RTM-R02); feature detection and a
  `BroadcastChannel` constructed to pass into its own extension (RTM-R03);
  `addEventListener` inside a `reatomObservable` descriptor that returns cleanup, and
  `atom.subscribe` handed to a framework binding (RTM-L01); a `computed` derived from
  `ready()` or a re-exported `error` (RTM-A03); a timer whose callback touches no unit
  (RTM-A05); composing two already-named model actions in one handler (RTM-S04); a unit not
  bound to a plain identifier (RTM-S05).
- **RTM-S06 stopped swallowing the async domain.** It fired on any hand-rolled async. Its
  marker is now a *gate* — a flag deciding whether or when async work runs — not scaffolding
  around a single request.
- **RTM-A05 and RTM-L01 no longer report each other's defects.** Reciprocal exceptions:
  recurring timers belong to L01, pure debounce timers to A05.

### Added — rules

- **RTM-A07** — read reactive inputs before the first `await`. Dependency tracking stops
  there, so a read below it never becomes a dependency and the value silently stops
  updating. Nothing throws.
- **RTM-A08** — cache async reads with `withCache` instead of a `Map` plus a `Date.now()`
  TTL.
- **RTM-S07** — derive collections with `computed` over the source plus a model cache keyed
  by id; `reatomLinkedList` is for collections you own and mutate.
- **RTM-L03** — run each SSR request inside its own `context.start()`. Without it the server
  writes into a process-wide root and one request's state reaches another's response.
- **RTM-R05** — neutralise `urlAtom.sync` before setting the URL on the server, or
  `history.pushState` throws inside a timer where nothing traces it.
- **RTM-R06** — `withSearchParams` and `withLocalStorage` on one atom interact: storage wins
  over a shared URL on cold start.
- **RTM-C02** — wrap React event handlers that touch Reatom. Unwrapped, they are not aborted
  on unmount.

### Added — guidance

- New `references/async-notes.md`: `withCache` options, the `wrap` / `bind` / `onEvent`
  distinction, and why tracking stops at the first `await`.
- `references/atomization-notes.md` gains sections on collections of models and on
  connection lifetime owning the async cache.
- `references/react-guide.md` gains event handlers and context, SSR request isolation and
  cache handoff, provider and `clearStack`, and a warning not to copy atom placement from
  upstream's JSX examples into React.
- `SKILL.md` names `@reatom/vite` for Vite dev setup; manual HMR uses `hot.dispose`, not
  `hot.accept(cb)`.

### Fixed — a real bug in the golden example

`golden-example.md`, a designated clean control, read `page()` after an `await` inside
`computed(async)`. Under RTM-A07 that read never becomes a dependency, so **paging would not
have refetched**. Found by the new rule before it audited any user code.

### Changed — vendored handbook

Re-synced from `af2f81f4` to `06a7f7a1`. Only `jsx.md` changed content: the Vite snippet now
includes the `reatom()` plugin, HMR guidance moved from `import.meta.hot.accept(cb)` to
`hot.dispose(cb)`, and a new limitation documents that detaching an ancestor of the mount
node leaks subscriptions.

### Internal

- The consistency suite checks that an auditor's body cites only its own domain's rules and
  states its full id range. It covered frontmatter only, and all five briefs had drifted.
- Calibration corpus gains a violation fixture for RTM-A07 and a second clean control built
  entirely from shapes that used to be false positives.
- Calibration procedure gains a mandatory version-parity precondition: auditors read the
  installed plugin cache, never the working tree, and two full runs have been lost to that.

### Known gaps

- RTM-A08, RTM-L03, RTM-R05, RTM-R06, RTM-S07 and RTM-C02 have no violation fixture yet;
  they are exercised only through the clean control's negative space.
- `audit-lifecycle` reports RTM-L01 on a raw `addEventListener` that RTM-A06 also owns. This
  is genuine dual ownership rather than a false positive, and the corpus model of one rule
  per defect does not express it.

## 0.2.0

Token-optimisation branch: per-domain rule slices, incremental per-file/domain audit
caching, and routing of each changed file to only the domains whose rules can fire on it.

## 0.1.0

Initial plugin layout: the Reatom v1001 skill, the rule registry, and the Stop-hook audit.
