---
description: Audit Reatom code against the rule registry by dispatching exactly the read-only domain auditors the router names — changed files by default, "all" for the whole repository, explicit paths, or "init" to write the when-to-run block into CLAUDE.md
argument-hint: "[all | init | <paths…>]"
---

Audit Reatom code in this repository against
`${CLAUDE_PLUGIN_ROOT}/skills/reatom/references/rules.md`.

## Pick the mode from `$ARGUMENTS`

| `$ARGUMENTS` | Run |
| --- | --- |
| empty | `node "${CLAUDE_PLUGIN_ROOT}/scripts/route.js" --changed` |
| `all` | `node "${CLAUDE_PLUGIN_ROOT}/scripts/route.js" --all` |
| `init` | `node "${CLAUDE_PLUGIN_ROOT}/scripts/init.js"` |
| anything else | `node "${CLAUDE_PLUGIN_ROOT}/scripts/route.js" <the arguments, verbatim>` |

`init` is not an audit. It does two independent things and reports both:

1. Writes the "when to run this" block into the project's `CLAUDE.md`, between
   `<!-- reatom-audit -->` and `<!-- /reatom-audit -->`, creating the file if it is
   missing and rewriting whatever sits between those delimiters if it is not.
2. Clones `reatom/reatom@v1001` into this machine's cache directory (or updates it if
   it is already there — shallow, single-branch, about 29 MB) and pins the path in
   `.git/.reatom-plugin/sources`, so the skill can read implementations, tests and
   examples instead of a bundled `.d.ts`.

The `CLAUDE.md` block is written even with no network. If either job fails the script
says which one and exits non-zero. Report what it printed and stop — there is nothing
to dispatch.

## Scope

**No arguments** — TypeScript changed across `merge-base(HEAD, <base>)..HEAD` plus
the working tree. The router resolves `<base>` itself — `origin/HEAD`, then
`main`/`master`/`develop`/`trunk`, then the branch with the youngest merge-base
against `HEAD` — and pins the answer in `.git/.reatom-plugin/base-branch`. Read that file
to see which branch is in use; overwrite it to correct a wrong guess, or write
`none` to audit the working tree alone. State from before 0.7 lived flat in
`.git/reatom-base-branch` and `.git/reatom-audit-last`; those names are still read, and
the first write moves each to `.git/.reatom-plugin/`. This mode is incremental: it skips
every file/domain pair whose contents and rule slice are unchanged since the last run.

**`all`** — every `.ts`/`.tsx` file in the repository, changed or not. The cache is
not consulted, so this re-audits everything; it is written afterwards, so a
following `/reatom-audit` starts from a clean slate.

**Explicit paths** — literal `.ts`/`.tsx` file paths. The router does not expand
globs or directories; anything else in the list is silently dropped. The cache is
neither read nor written, so a named file is always audited.

`.reatom-audit-ignore` at the project root (the pre-0.6 name `.reatom-gate-ignore`
still works) excludes paths from the changed and `all` scopes. It is deliberately
not applied to explicit paths — you named those files, so you get them.

## Run

Get the dispatch orders first. The router decides which auditors can fire on which
files; do not decide that yourself.

Dispatch exactly the auditors it names, IN PARALLEL, one Agent call each, giving
each one only the files listed under its own name and the slice it names. An
auditor the router did not name has no matching code and must not be dispatched.

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
