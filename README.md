# Reatom for Claude Code

A [Reatom v1001](https://v1001.reatom.dev) skill, plus an audit command that checks
TypeScript against a rule registry.

## Install

```bash
claude plugin marketplace add khmilevoi/reatom-skill
claude plugin install reatom@reatom
```

Then, once per project that should use the audit:

```
/reatom-audit init
```

That writes a short block into the project's `CLAUDE.md`, between
`<!-- reatom-audit -->` and `<!-- /reatom-audit -->`, saying when the audit is due —
after a change that touched Reatom code, before the work is reported as done. Re-running
`init` rewrites whatever sits between those delimiters, so a later release's wording lands
without the operator having to diff anything. Nothing in this plugin fires on its own;
that block is the whole trigger.

## What you get

**The skill.** Reatom guidance routed through four sources, in order: the rule registry,
the vendored upstream handbook, the upstream checkout on this machine, and the Reatom
your own project installed. The checkout explains how the code works but tracks `v1001`
branch HEAD, not your release; when the vendored docs and your installed `@reatom/core`
disagree, your installed types win — they are what your code runs against.

**The audit.** `/reatom-audit` routes each file in scope to the domains whose rules can
fire on it — async, state, lifecycle, routing/forms, React — and dispatches read-only
auditors, in parallel, only for the domains that still have unaudited work, each
reporting only violations it can pin to a rule id, a `file:line`, and a named replacement
API. Every finding is then fixed or dismissed with a written rationale.

Three scopes:

| Invocation | Scope | Ignore file | Cache |
| --- | --- | --- | --- |
| `/reatom-audit` | TypeScript changed against the base branch, plus the working tree | applied | read and written |
| `/reatom-audit all` | every `.ts`/`.tsx` file in the repository | applied | ignored going in, written coming out |
| `/reatom-audit <paths>` | exactly the files you name, changed or not | not applied | untouched |

The changed scope is incremental: it caches which file/domain pairs it has already
audited against which rule slice and skips a pair once its cache entry matches, so a
re-run after a small follow-up edit usually dispatches nothing at all. The base branch is
resolved from `origin/HEAD`, then `main`/`master`/`develop`/`trunk`, then the commit
graph, and the answer is pinned in `.git/.reatom-plugin/base-branch` — overwrite that file
to correct a wrong guess, or write `none` to audit the working tree alone.

Everything the plugin remembers about a project lives in `.git/.reatom-plugin/` —
`base-branch`, `audit-last`, and `sources`. The pre-0.7 flat names
`.git/reatom-base-branch` and `.git/reatom-audit-last` are still read, so an upgrade
loses nothing.

`/reatom-audit init` also clones `reatom/reatom@v1001` into this machine's cache
(`%LOCALAPPDATA%\reatom-claude-plugin\sources` on Windows,
`${XDG_CACHE_HOME:-~/.cache}/reatom-claude-plugin/sources` elsewhere — shallow,
single-branch, about 55 MB, one clone shared by every project) and pins the path in
`.git/.reatom-plugin/sources`. The skill reads implementations, tests, docs and
examples from there instead of from an installed `.d.ts`. Upstream keeps one example
app's raw camera fixtures in Git LFS; the clone leaves those as pointers, because the
skill reads code and fetching them would cost another 440 MB — run `git lfs pull` in
the checkout if you ever want the originals. Nothing updates that clone on its own:
re-run `init` to fetch. Point the pin at your own Reatom checkout to work
against it, or write `none` to keep the skill on `node_modules` alone.

A diff only ever shows what changed, so pre-existing debt is invisible to the default
scope. `all` and explicit paths are how you reach it.

`.reatom-audit-ignore` at the project root — gitignore-style globs, `#` comments, no
negation — permanently excludes paths that are not audit surface, such as test fixtures
or scanner code that treats Reatom tokens as data. It is yours to maintain: the plugin
never writes to it. Naming a file on the command line overrides it, so a deliberate audit
still reaches excluded paths. The pre-0.6 name `.reatom-gate-ignore` is still read.

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
