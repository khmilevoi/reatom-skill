# Reatom for Claude Code

A [Reatom v1001](https://v1001.reatom.dev) skill, plus an audit that checks changed
TypeScript against a rule registry before a session can finish.

## Install

```bash
claude plugin marketplace add khmilevoi/reatom-skill
claude plugin install reatom@reatom
```

## What you get

**The skill.** Reatom guidance routed through three sources in order: the rule registry,
the vendored upstream handbook, and the Reatom your own project installed. When the
vendored docs and your installed `@reatom/core` disagree, your installed types win — they
are what your code runs against.

**The audit.** A Stop hook that fires when a session changed TypeScript in a project with
`@reatom/*` in its `package.json`. It routes each changed file to the domains whose rules
can fire on it — async, state, lifecycle, routing/forms, React — and dispatches read-only
auditors, in parallel, only for the domains that still have unaudited work, each reporting
only violations it can pin to a rule id, a `file:line`, and a named replacement API. Every
finding is then fixed or dismissed with a written rationale.

The gate is incremental: it caches which file/domain pairs it has already audited against
which rule slice, and skips a pair once its cache entry matches. A Stop can pass with no
auditor dispatched at all when everything routed has already been audited.

Three mechanisms keep the gate honest about scope. A `.reatom-gate-ignore`
file at the project root — gitignore-style globs, `#` comments, no negation —
permanently excludes paths that are not audit surface, such as test fixtures
or scanner code that treats Reatom tokens as data. It is yours to maintain:
the plugin never writes to it, and `/reatom-audit` deliberately does not
apply it, so a manual audit still reaches excluded paths. Second, the gate
proves consultation-only sessions innocent mechanically: before blocking, it
scans the session transcript against an allowlist of read-only tools, and a
session that never invoked anything that could touch the working tree is
allowed through silently — the cache stays unwritten so the changes resurface
in the next working session, and a one-line message tells the operator which
files were left unaudited. Anything unprovable — a Bash call, a subagent, an
unreadable transcript — fails closed to a normal block. Third, the block
reason opens with a triage step: the session judges, from its own
conversation context and without inspecting files, whether it actually made
the listed changes. Changes it is certain it did not make are skipped and
reported to the operator with the follow-ups (`/reatom-audit <paths>`, or an
ignore entry); files it is genuinely unsure about go to the operator as one
AskUserQuestion — audit or skip — and unsure still fails toward auditing
when asking is impossible.

Non-Reatom projects and sessions with no TypeScript change exit silently.

Run it by hand against any path with `/reatom-audit [path]`. The gate only ever sees the
diff, so pre-existing debt is invisible to it; the command is how you point it at code
that has not changed.

## The rules

`skills/reatom/references/rules.md` is the registry: one entry per rule, each with a
domain owner, a bad and good example, detection criteria, and its exceptions. The
auditors cite it and report nothing they cannot name an id for. No id, no finding — a
missed violation costs one violation, but a false positive costs trust in the audit, and
an audit nobody trusts gets uninstalled.

## Credits

The handbook under `skills/reatom/references/upstream/` is the Reatom project's own
documentation, vendored verbatim from [reatom/reatom](https://github.com/reatom/reatom)
under MIT. See [NOTICE](NOTICE). Upstream owns the explanation; this plugin adds the
enforcement.

## Contributing

See [development/README.md](development/README.md).
