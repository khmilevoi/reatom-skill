---
title: 'Reatom skill baseline results'
description: 'Observed failures and rationalizations from pressure testing the Reatom v1000 skill'
---

# Reatom Skill Baseline Results

These results record how agents behave on `references/test-scenarios.md`.
Fill this file when scenarios are run without and with the skill.

## Results Table

| Scenario | Without skill | With skill | Doc change needed |
| --- | --- | --- | --- |
| Async List Query | Not run | Not run | Pending |
| Direct State Setter | Not run | Not run | Pending |
| Route Data Loading | Not run | Not run | Pending |
| Editable List Item UI State | Not run | Not run | Pending |
| Async Boundary After Callback | Not run | Not run | Pending |
| Debounced Search | Not run | Not run | Pending |
| React Hook Orchestration with Enabled Flags | Not run | Not run | Pending |

## Rationalizations To Watch

- "Setter actions are better for logging."
- "A React `useEffect` fetch is simpler."
- "Manual loading/error atoms are more explicit."
- "Route matching in components is easier to understand."
- "Normalized maps are always the scalable option."
- "Wrapping is unnecessary after the first await."
- "React-style enabled flags are the clearest way to coordinate conditional async work."

## Result Entry Template

```md
### Scenario N: Name

Without skill:
- Pattern chosen:
- Exact wrong recommendation:
- Exact rationalization:

With skill:
- Pattern chosen:
- Remaining issue:

Doc change needed:
- None/Pending:
```
