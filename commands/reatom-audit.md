---
description: Audit Reatom code against the rule registry with five parallel read-only domain auditors
---

Audit Reatom code in this repository against `${CLAUDE_PLUGIN_ROOT}/skills/reatom/references/rules.md`.

## Scope

Use `$ARGUMENTS` when given — a path, a glob, or a directory. With no arguments,
audit the same set the Stop gate would: changed TypeScript across
`merge-base(HEAD, main)..HEAD` plus the working tree.

Unlike the gate, you may be pointed at code that has not changed. That is the
point of this command: the gate only ever sees the diff, so pre-existing debt is
invisible to it.

## Run

Get the dispatch orders first — the router decides which auditors can fire on
which files, using the same code the Stop gate uses:

```bash
node "${CLAUDE_PLUGIN_ROOT}/hooks/route.js" <paths…>
```

With no paths, pass the changed set the gate would use: TypeScript across
`merge-base(HEAD, main)..HEAD` plus the working tree.

Dispatch exactly the auditors the router names, IN PARALLEL, one Agent call each,
giving each one only the files listed under its own name and the slice it names.

This command audits everything you point it at — it is not incremental. The gate
caches files it has already seen; this command exists to inspect code the gate
never does, including unchanged files.

## Report

Collect the findings and deduplicate by `rule_id` + `file` + `line`.

For each finding, either fix it or dismiss it with a written rationale. Then
finish with:

```
Audit: N findings, M fixed, K dismissed
  RTM-S01 dismissed: setUser performs validation, not pass-through forwarding
```

Spell out every dismissal so the operator can judge it. A silent dismissal defeats
the audit — the agent that forgot a rule is equally able to rationalise ignoring
it, and visibility is the only thing that keeps that honest.

If an auditor fails or times out, say which domain went unaudited rather than
implying it was clean.
