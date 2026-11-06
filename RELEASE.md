# Releases

General rule: `../AGENTS.md`; full procedure: `taxami-webapp/AGENTS.md` (ADR-045). `main` is tagged
and the tag identifies the published build; a commit or a branch is not a release.

## Version

`VERSION` (root of this repo), semantic version. The release PR bumps it (`main` takes no direct
pushes); the tag is `v` + that version. Keep `VERSION` equal to the latest published release. Levels
while major is 0: **patch** = fix, **minor** = new capability or contract change, **major** (`1.0.0`)
= the approver's decision.

## Tag and publish

1. The release PR is merged by its creator, with the approver's explicit via — Marco or the CTO (Luigi Brancati) — in that conversation (per PR for a merge, per version for a release; the release via names the version: `release vX.Y.Z: merge, tag, publish`); the Windows `.exe` has been built and tested.
2. On `main`, clean tree, `VERSION` equals `X.Y.Z`, on the release PR's **merge commit**
   (`git rev-list --parents -n 1 HEAD` prints two parents; a squash promotion is forbidden):

   ```bash
   git tag -a vX.Y.Z -m '<included PRs and changelog numbers>'
   git push origin refs/tags/vX.Y.Z
   ```

   Docs-only and CI-only PRs are not releases: they merge, get no tag, and ship with the next
   release (`git log vLATEST..origin/main` lists what is unreleased).

3. Create the GitHub release for the tag and attach the built binary as `TaxamiStudioAgent.exe`.
   The README download link (`/releases/latest/download/TaxamiStudioAgent.exe`) follows the latest
   release, so the asset name is part of the contract.

There is no server: publishing the release asset is the deploy, and nothing else runs in production.

## Rollback

Re-publish the previous release as the latest (or attach the previous binary to a new tag); never
move or delete a deployed tag. A wrong release gets a new version.

## Hotfix

The tag rule wins: a hotfix is a **fast lane of the same procedure**, never an exception. Order:

1. **Roll back first.** Re-publish the previous release as the latest (see Rollback), so users can
   install a working build while the real fix is prepared.
2. **Fast lane.** PR **from `main`** (not from an integration branch), `.exe` built and tested, merged
   with its own via, **patch release** with the tag on that merge commit, then publish the release as
   above. The fix PR may carry the bump. A tag is **never** created on a hotfix branch.
3. **Break-glass** only when 1 and 2 are impossible (for example GitHub or the Actions quota is down)
   and the approver explicitly authorizes it naming "break-glass": the commit is on a branch on
   GitHub, the worktree is clean, the published asset reports that commit (`BUILD_COMMIT`), and the
   release notes mark the build **UNTAGGED**. Reconcile the same day with a PR, merge, tag and a
   re-published release.

## Out of scope

There is no preview or `develop` deployment for this component.
