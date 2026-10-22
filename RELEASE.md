# Releases

General rule: `../AGENTS.md`; full procedure: `taxami-webapp/AGENTS.md` (ADR-045). `main` is tagged
and the tag identifies the published build; a commit or a branch is not a release.

## Version

`VERSION` (root of this repo), semantic version. The release PR bumps it; the tag is `v` + that
version. Keep `VERSION` equal to the latest published release.

## Tag and publish

1. PR merged by its creator (only the CTO or Marco); the Windows `.exe` has been built and tested.
2. On `main`, clean tree, `VERSION` equals `X.Y.Z`:

   ```bash
   git tag -a vX.Y.Z -m '<summary>'
   git push origin refs/tags/vX.Y.Z
   ```

3. Create the GitHub release for the tag and attach the built binary as `TaxamiStudioAgent.exe`.
   The README download link (`/releases/latest/download/TaxamiStudioAgent.exe`) follows the latest
   release, so the asset name is part of the contract.

There is no server: publishing the release asset is the deploy, and nothing else runs in production.

## Rollback

Re-publish the previous release as the latest (or attach the previous binary to a new tag); never
move or delete a deployed tag. A wrong release gets a new version.

## Out of scope

There is no preview or `develop` deployment for this component.
