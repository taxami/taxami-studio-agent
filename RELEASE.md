# Releases

General rule: `../AGENTS.md`; full procedure: `taxami-webapp/AGENTS.md` (ADR-045). `main` is tagged
and the tag identifies the published build; a commit or a branch is not a release.

## Version

`VERSION` (root of this repo), semantic version. The release PR bumps it (`main` takes no direct
pushes); the tag is `v` + that version. Keep `VERSION` equal to the latest published release. Levels
while major is 0: **patch** = fix, **minor** = new capability or contract change, **major** (`1.0.0`)
= the approver's decision.

`VERSION` is also the client's identity: `scripts/build-exe.mjs` injects it into `studio-agent.js`
as `AGENT_VERSION`, so the published `.exe` prints it, sends it in every poll and answers to
`--version`. There is no second copy of the number in the repo.

## Build

The `.exe` is produced only by `scripts/build-exe.mjs`; no binary is ever built on a PC and attached
by hand. What the build fixes in place:

- target `node24-win-x64` (base binary fetched by `@yao-pkg/pkg`, checksum-verified by pkg-fetch);
- `--no-bytecode`: the script travels inside the exe as plain text, so `npm run verify:embedded`
  can prove the shipped script is the tagged one;
- `AGENT_VERSION` replaced by `VERSION`, and the build refuses to run when a pushed tag `vX.Y.Z`
  disagrees with `VERSION`;
- output `dist/TaxamiStudioAgent.exe`, `dist/studio-agent.js` (the same source with `VERSION`
  injected, for users who run the agent with Node) and `dist/SHA256SUMS.txt` with the digest of both.

Measured on 2026-10-27 (pkg 6.24.0): two consecutive builds of the same tree produced the same sha256
(`f23de8db…` on Linux, `fdf049ff…` on the Windows runner), so CI can gate on a repeated build.
The digest is **per platform**, not global: a Linux cross-build and a Windows build of the same
commit differ, so never compare a local hash with the published one — the published artifact comes
from `windows-latest`, and the guarantee is the embedded-source check, not the hash. The Windows
executable is 93,332,266 bytes against the 37,678,828 of the v2.2.0 Node 18 build: Node 24 bases are
simply larger. The artifact stays unsigned; SmartScreen behaviour is unchanged.

## Tag and publish

1. The release PR is merged by its creator, with the approver's explicit via — Marco or the CTO (Luigi Brancati) — in that conversation (per PR for a merge, per version for a release; the release via names the version: `release vX.Y.Z: merge, tag, publish`). CI on the PR has already built the `.exe` and run it on a Windows runner; nothing else has to be built.
2. On `main`, clean tree, `VERSION` equals `X.Y.Z`, on the release PR's **merge commit**
   (`git rev-list --parents -n 1 HEAD` prints two parents; a squash promotion is forbidden):

   ```bash
   git tag -a vX.Y.Z -m '<included PRs and changelog numbers>'
   git push origin refs/tags/vX.Y.Z
   ```

   Docs-only and CI-only PRs are not releases: they merge, get no tag, and ship with the next
   release (`git log vLATEST..origin/main` lists what is unreleased).

3. `.github/workflows/release.yml` takes over from the tag push: it asserts `VERSION` == the tag,
   rebuilds, checks the embedded source, runs the binary (`--version`, `--self-test`) and the
   end-to-end harness on `windows-latest`, signs a build provenance attestation, creates the release
   with `gh release create --verify-tag` and attaches `TaxamiStudioAgent.exe`, `studio-agent.js` and
   `SHA256SUMS.txt`, then re-downloads the published assets and compares the digests. The download
   links (`/releases/latest/download/TaxamiStudioAgent.exe` here and in the README,
   `/releases/latest/download/studio-agent.js` and `/SHA256SUMS.txt` on taxami.it `/studio/agente`)
   follow the latest release, so the asset names are part of the contract. If the workflow is ever bypassed by a manual upload, the release is
   invalid: delete the asset and re-run the workflow on the tag.

There is no server: publishing the release asset is the deploy, and nothing else runs in production.

## Verification (any release)

```bash
gh release download vX.Y.Z -R taxami/taxami-studio-agent
sha256sum -c SHA256SUMS.txt
gh attestation verify TaxamiStudioAgent.exe --repo taxami/taxami-studio-agent   # workflow + repo + commit
gh attestation verify studio-agent.js --repo taxami/taxami-studio-agent
npm run verify:embedded -- --exe TaxamiStudioAgent.exe                          # script == tag
```

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
