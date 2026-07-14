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
`@reatom/*` in its `package.json`. It dispatches five read-only auditors in parallel, one
per domain — async, state, lifecycle, routing/forms, React — each reporting only
violations it can pin to a rule id, a `file:line`, and a named replacement API. Every
finding is then fixed or dismissed with a written rationale.

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
