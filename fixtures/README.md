# Audit calibration fixtures

Real bad code from `references/baseline-results.md` and
`references/observed-misuse-cases.md`, plus one clean control.

No fixture names the rule it breaks. Naming it would hand the auditor the answer —
the same leak that makes `evals/evals.json` non-discriminating, because its prompts
are verbatim copies of `references/test-scenarios.md`, which ships the expected
patterns beside them.

## Why the clean fixture matters more

`expected.json`'s `clean` entry must produce **zero** findings. A missed violation
costs one violation. A false positive costs trust in the audit, and an audit
nobody trusts gets uninstalled — back to the problem this plugin exists to solve.

## Procedure

Calibration needs live agents, so it does not run under `node --test`. Run it by
hand after changing any brief or rule:

1. For each auditor, dispatch it against `fixtures/violations/` with the same
   prompt the gate produces.
2. Score: does it report exactly the ids in `expected.json` for its own domain?
   Rules from other domains are not its job and are not misses.
3. Dispatch all five against the clean fixture. **Any** finding is a failure —
   investigate the brief or the rule's `exception` before touching the fixture.
4. Record the outcome in `references/baseline-results.md`, following the existing
   iteration format.

`node --test` covers only the corpus's shape: every expectation names a real rule,
no fixture leaks its ids, the clean control points at the golden example.
