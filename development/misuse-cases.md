# Observed Reatom misuse cases (field log)

> **Gitignored, local-only.** Raw material for improving the skill (new doc
> guidance, `Do Not Recommend` entries, and `evals/evals.json` assertions).
> Each entry is a real anti-pattern caught reviewing production code, with the
> Reatom-native fix and a concrete proposal for what the skill should do so an
> agent avoids it next time. Append new cases; promote resolved ones into
> `llm.md` / `evals.json` and note the promotion.

## Source: myboard `feat/activate-redesign-login` (add-device / activation flow)

Reviewed the PR's client code (`packages/client/activation/src`). The fixes
landed in commit `e0df4e6` ("refactor(activation): idiomatic Reatom lifecycle
for add-device flow"); the "before" state is its parent commits. All cases are
from an app that already uses Reatom idiomatically in most places (routes via
`reatomRoute` loaders, `wrap()` on every await, `reatomForm`, named units), so
these are the *residual* misuses an otherwise-fluent author still made.

---

### Case 1 — Side-effect timer (`setInterval`) managed imperatively, not bound to atom connection

**Severity:** high (resource + network leak, not just style).

**Symptom.** A status poller was a plain `window.setInterval` started by a
`beginPolling()` helper and torn down by `stopPolling()`, with a module-local
`pollIntervalId`, a manual `pollTicks` counter, and a `claiming` single-flight
boolean. `stopPolling()` was only called on terminal poll outcomes
(approved/denied/timeout). Nothing tied the timer to the model's lifetime.

**Why it's wrong.** The model was created inside a `reatomRoute` loader (the
"computed factory" pattern), so it is meant to live only while the route is
active. But the interval's lifetime was independent: navigating away during
polling left the timer firing every 2s for up to its 10-minute cap, hitting the
server and pinning the model in memory. The whole point of the computed-factory
lifetime was silently defeated by an unmanaged side effect.

**Reatom-native fix.** Bind the interval to *atom connection* with
`withConnectHook`: create the interval in the connect hook and return a cleanup
that clears it. Expose the atom and have the view read it only in the state that
needs polling; connection (view mounts) starts it, disconnection (navigate away
/ leave state) stops it. This is exactly the repo's own `now`-clock idiom
(`account/model/add-device-model.ts`, and `packages/widgets/clock`). The manual
`beginPolling`/`stopPolling`/`pollIntervalId` all disappear; the interval
self-stops on a terminal mode change as a belt-and-suspenders for lingering test
subscriptions.

```ts
const poll = atom<undefined>(undefined, 'x.poll').extend(
  withConnectHook(() => {
    const id = window.setInterval(wrap(() => { /* … */ void pollStatus() }), 2_000)
    return () => window.clearInterval(id)
  }),
)
// view: `if (state === 'waiting') model.poll()`  // reading == connecting
```

**Proposed skill change.**
- `llm.md` → *Lifecycle and extension hooks*: add an explicit rule — "Any
  long-lived side effect (interval, timeout, subscription, event listener)
  started by a model must be owned by `withConnectHook` returning a cleanup, so
  its lifetime tracks connection. Never start a bare `setInterval`/`addEventListener`
  in a factory or action with manual start/stop." Cross-link the `now`-clock
  example.
- `Do Not Recommend`: add "Bare `setInterval`/`setTimeout`/`addEventListener`
  with hand-rolled start/stop instead of `withConnectHook` cleanup."
- Eval: a polling/timer scenario asserting the timer is created inside a
  `withConnectHook` cleanup pair, not an imperative begin/stop.
- Note the trap: `effect()` is *not* the right tool here — it self-subscribes on
  creation and never disconnects, so it would re-introduce the leak. The skill
  should say connection-bound side effects use `withConnectHook`, not `effect`.

---

### Case 2 — Async action without `withAsync`, forcing the component to reinvent pending state

**Severity:** medium.

**Symptom.** An async `action` (`startRegistration`) exposed no loading flag, so
the React component tracked it with `const [pending, setPending] = useState(false)`
and wrapped every call site in `void model.action().finally(() => setPending(false))`.
Tellingly, a sibling model in the same PR (`activation-model.ts`) did it right:
`startLogin` had `.extend(withAsync())` and a `loading` computed off
`.ready()`. The author even wrote a comment admitting the action "has no exposed
pending flag of its own (unlike activation-model.ts's `loading` computed)."

**Why it's wrong.** This is the "Manual loading/error atoms" anti-pattern, just
relocated into React state. The in-flight status already exists in Reatom the
moment you add `withAsync`; duplicating it in `useState` risks drift and pushes
model concerns into the view.

**Reatom-native fix.** `.extend(withAsync())` on the action, expose a
`computed(() => !action.ready(), 'x.pending')`, and read that from the view.
Delete the `useState` + `.finally()` scaffolding.

**Proposed skill change.**
- Strengthen the existing *withAsync* guidance / `Do Not Recommend` "Manual
  loading/error atoms" to explicitly include **React `useState` + `.finally()`
  around a Reatom action call** as a form of the same anti-pattern — agents may
  not recognize local component state as "manual loading atoms."
- Eval: a mutation-with-button-spinner scenario asserting the button reads
  `!action.ready()` (via a computed), with zero `useState` for pending.

---

### Case 3 — Screen/state transitions done as raw `atom.set()` in DOM handlers instead of named model actions

**Severity:** low–medium (traceability + altitude).

**Symptom.** View components mutated model state directly from `onClick`
handlers — `model.mode.set('scanning')`, `model.error.set(null)`,
`model.screen.set('home')` — plus a manual `notify()` to force a synchronous
flush. These are genuine business transitions (they live in the model's state
machine) but were authored in the view.

**Why it's wrong.** Untraceable (no named action in the log), and it leaks model
logic into `ui/`, against the repo's own "logic in model/, glue in ui/"
convention. Note `notify()` is still needed for a synchronous flush from a raw
DOM handler even after wrapping in an action — so the fix is about *ownership and
naming*, not about removing `notify`.

**Reatom-native fix.** Expose named actions on the model (`goToScan`,
`goToManual`, `goToChoose`, `goHome`) that perform the `set`s; the view calls
them (still followed by `notify()` where a sync flush is required). View keeps
only genuinely view-local state (e.g. a controlled input's string).

**Proposed skill change.**
- `llm.md` → *React-to-Reatom decision guide*: add a row — "Multi-atom or
  semantically-named state transition triggered from the UI → a named model
  `action`, not raw `atom.set()` calls in the handler." Keep the existing
  guidance that a *single* trivial `atom.set(value)` does **not** need an action
  (don't over-correct into identity setters — that's a separate `Do Not`).
- Clarify the boundary so agents don't swing to the opposite anti-pattern:
  single direct set = `atom.set` inline; grouped/named transition = action.

---

### Case 4 (minor / doc-hygiene, not a Reatom API misuse) — stale lifecycle rationale after a routing migration

**Symptom.** After moving one-time init from a mount `useEffect` into the route
loader (`await model.init()`), the `init` doc comment still explained a
"React StrictMode double-invoked mount effect" and the idempotency guard was
justified by that now-nonexistent call site.

**Takeaway for the skill.** When the skill recommends migrating imperative
`useEffect` init into a route `loader` (a default it already promotes), it should
remind the author to re-justify any leftover idempotency/StrictMode guards — the
loader is a single call site, so the *reason* changes even if the guard stays as
defense. Candidate one-liner in the *Routing* section's loader guidance.

---

## Meta-observation

All four cases share a shape: **the author knew the right Reatom tool and used it
elsewhere in the very same PR** (`withConnectHook` for the `now` clock,
`withAsync` for `startLogin`, loaders for routing) but reached for an imperative
escape hatch at one specific spot. The skill's evals mostly test "greenfield,
which pattern do you pick"; these misuses are "you already picked right once —
do you apply it *consistently* to the next side effect / async action." Worth a
class of eval that seeds a correct usage and checks the agent doesn't hand-roll
the second one.
