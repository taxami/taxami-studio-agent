@AGENTS.md

## Delegation to subagents

This is a standing instruction from the repository owner: **delegate proactively, without waiting to be asked.** The main session runs on the strongest model and keeps the reasoning, the design decisions, the risky edits and every conversation with the approver; mechanical or bounded work goes to the subagents in `.claude/agents/`, each pinned to a cheaper model.

| Situation | Subagent | Model |
|---|---|---|
| Finding code or docs that needs more than 2-3 searches; reading an ADR/SEC entry; sweeping sibling repos | `Explore` (overrides the built-in) | Haiku |
| After any code change, and before saying work is done: the narrowest tests, type and lint checks | `test-runner` | Haiku |
| Before proposing a merge, `gh pr ready` or a release; any "status of PR/CI" question | `pr-status` | Haiku |
| A change touches a file mirrored between `taxami-webapp` and `taxami-kb` (feature flags, embedding recipe, `extractLegalRefs`, KB contract) - those two repos only | `mirror-drift` | Haiku |
| Before every push and before opening/updating a PR | `diff-guard` | Sonnet |
| End of a material change: changelog/handoff entry, state docs, PR body | `handoff-writer` | Sonnet |
| Grunt work: a decided change to apply in more than three places (renames, call-site updates, moving to a shared module, syncing a mirrored copy) | `bulk-edit` | Sonnet |
| Grunt work: tests for code you just wrote, including the regression test for a fix | `test-writer` | Sonnet |
| Grunt work: lint/type/syntax errors in the files the change touched | `lint-fix` | Haiku |

Rules:

- Launch independent subagents in parallel (e.g. `test-runner` and `diff-guard` together).
- Give each one a self-contained brief: it does not see this conversation. Name the repo, base branch, files touched and what you want back.
- Grunt-work agents edit files but never commit: read their `git diff` before building on it. Do not run two of them on the same files at once.
- Treat their output as evidence to check, not as a decision. The main session still owns the result, and never cites a check it did not see reported.
- Do not delegate: schema/migration design, security fixes, release and merge steps, anything needing the approver's via, or a task smaller than the brief you would have to write.
- The same definitions (`mirror-drift` only in `taxami-webapp` and `taxami-kb`) and this section live in every TaxAmi repository and must stay identical: change them in all repositories in the same intervention (skill `cross-repo-policy-propagation` in `taxami-webapp`).
