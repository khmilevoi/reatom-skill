# Audit calibration fixtures

Real bad code from [`../baseline-results.md`](../baseline-results.md) and
[`../misuse-cases.md`](../misuse-cases.md), plus two clean controls.

`clean/sanctioned-shapes.ts` is the second one, and it exists for a specific
reason. Several rules carry exceptions because upstream's own examples and
handbook use the shape the rule would otherwise flag — an `effect` inside an
abortable scope, `addEventListener` inside an observable descriptor that returns
cleanup, a `URLSearchParams` built for an outbound request, a `BroadcastChannel`
constructed to hand to its own extension, a `computed` derived from `ready()`, a
timer that touches no unit. Every one of those was a false positive this audit
used to produce. The fixture is a standing check that the exceptions still hold:
a finding against it means a rule has drifted back to flagging correct code.

No fixture names the rule it breaks. Naming it would hand the auditor the answer —
the same leak that sank the old `evals.json`, whose prompts were verbatim copies of
[`../scenarios.md`](../scenarios.md), which ships the expected patterns beside them.

## Why the clean fixture matters more

`expected.json`'s `clean` entry must produce **zero** findings. A missed violation
costs one violation. A false positive costs trust in the audit, and an audit
nobody trusts gets uninstalled — back to the problem this plugin exists to solve.

## Procedure

Calibration needs live agents, so it does not run under `node --test`. Run it by
hand after changing any brief or rule:

0. **Prove the auditors will read the code you changed.** They resolve
   `${CLAUDE_PLUGIN_ROOT}` to the *installed* plugin cache, never to this working
   tree, so uncommitted work is invisible to them. Compare the rule count here
   against the installed copy:

   ```bash
   grep -c '^### RTM-' skills/reatom/references/rules.md
   grep -c '^### RTM-' "$INSTALL/skills/reatom/references/rules.md"
   ```

   and confirm any id you mean to exercise is present in the installed
   `rules-<domain>.md` slice. If they differ, back up the cache's `skills/` and
   `agents/`, copy this tree's over them, and restore when finished — or publish
   and reinstall. **A run whose counts did not match is not a result and must not
   be scored.** This has cost two full discarded runs: iteration 3's first attempt
   and the whole first pass of iteration 4, where a new rule looked like a
   detection failure when it simply was not in the slice the auditor read.

1. For each auditor, dispatch it against `violations/` with the same
   prompt the gate produces.
2. Score: does it report exactly the ids in `expected.json` for its own domain?
   Rules from other domains are not its job and are not misses.
3. Dispatch all five against the clean fixture. **Any** finding is a failure —
   investigate the brief or the rule's `exception` before touching the fixture.
4. Record the outcome in [`../baseline-results.md`](../baseline-results.md), following
   the existing iteration format.
5. On the clean fixture, any reply other than the exact sentinel line — including
   a correct "no findings" wrapped in prose — is a calibration failure. The
   contract is part of what calibration measures, not a formatting preference.

`development/tests/` does not cover this corpus. Its shape checks were dropped with the
rest of the ceremony — calibration needs live agents, so a test asserting that a fixture
does not name its own rule id was guarding a procedure a human runs anyway.
