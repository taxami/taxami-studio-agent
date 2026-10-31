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

## Out of scope

There is no preview or `develop` deployment for this component.
