# Releases

General rule: `../AGENTS.md`; full procedure: `taxami-webapp/AGENTS.md` (ADR-045) and
`taxami-webapp/docs/RELEASE_CHECKLIST.md`. `main` is tagged and the tag identifies the published build;
a commit or a branch is not a release. The sections are the same in every repository of the workspace;
where one does not apply, it says so.

## Merge

- This repository works on `main`: PRs target `main`. The `develop` branch exists but is not used (no
  PRs); while it exists it receives the light sync after every release (below).
- The release PR is merged by its creator, with the approver's explicit via — Marco or the CTO (Luigi
  Brancati) — in that conversation (per PR for a merge, per version for a release). The release via
  names the version: `release vX.Y.Z: merge, tag, publish`.
- The merge into `main` is a **true merge commit**: `gh pr merge --merge --delete-branch`, never
  `--squash` or `--rebase`; the tag goes on that two-parent commit. The rule calls for a ruleset on
  `main` that permits merge commits only (admin action in `../docs/blockers/github-admin-actions.md`;
  the repository's ruleset list is empty today), so the method is kept by hand.
- The merge deletes the branch: `--delete-branch` removes it on the remote in the same act (the
  repository's *Automatically delete head branches* setting is off; turning it on is an admin action).
  Only default branches (`main`, `develop`) survive, plus a branch another open PR is based on, which
  goes when that PR merges or is retargeted: deleting it first closes the stacked PR (2026-11-01, #2).
  A merged branch left on the remote is a violation of the rule, not a leftover.
- Docs-only and CI-only PRs are not releases: they merge, get no tag, and ship with the next release.

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

## Before the tag

- CI on the release PR has already built the `.exe` and run it on a Windows runner; nothing else has to
  be built.
- On `main`: clean tree, `HEAD` is the release PR's **merge commit** (`git rev-list --parents -n 1 HEAD`
  prints two parents; one parent means a squash: redo it, do not tag), `VERSION` equals `X.Y.Z`, and the
  tag is absent: `git ls-remote --tags origin refs/tags/vX.Y.Z` is empty.
- **Downtime window.** Does not apply: publishing a release does not stop the agents already running on
  the studios' PCs; each one updates when its user installs the new build.
- **Neon backup branches.** The agent uses no database. If a release ever takes a Neon backup branch
  (for example before a webapp migration it depends on), the branch is created with `expires_at` 14
  days after creation and never without an expiry: the workspace rule, detailed in
  `taxami-webapp/docs/RELEASE_CHECKLIST.md` §5.

## Tag

```bash
git tag -a vX.Y.Z -m '<included PRs and changelog numbers>'
git push origin refs/tags/vX.Y.Z
git cat-file -t vX.Y.Z                       # tag (annotated)
git rev-list --parents -n 1 vX.Y.Z^{commit}  # two parents: the merge commit
```

The tag is created after the release PR is merged, on the merge commit on `main`, never on a working
branch (`git log vLATEST..origin/main` lists what is unreleased).

## Deploy (publish)

`.github/workflows/release.yml` takes over from the tag push: it asserts `VERSION` == the tag,
rebuilds, checks the embedded source, runs the binary (`--version`, `--self-test`) and the
end-to-end harness on `windows-latest`, signs a build provenance attestation, creates the release
with `gh release create --verify-tag` and attaches `TaxamiStudioAgent.exe`, `studio-agent.js` and
`SHA256SUMS.txt`, then re-downloads the published assets and compares the digests. The download
links (`/releases/latest/download/TaxamiStudioAgent.exe` here and in the README,
`/releases/latest/download/studio-agent.js` and `/SHA256SUMS.txt` on taxami.it `/studio/agente`)
follow the latest release, so the asset names are part of the contract. If the workflow is ever bypassed by a manual upload, the release is
invalid: delete the asset and re-run the workflow on the tag.

There is no server: publishing the release asset is the deploy, and nothing else runs in production.
Verify every release:

```bash
gh release download vX.Y.Z -R taxami/taxami-studio-agent
sha256sum -c SHA256SUMS.txt
gh attestation verify TaxamiStudioAgent.exe --repo taxami/taxami-studio-agent   # workflow + repo + commit
gh attestation verify studio-agent.js --repo taxami/taxami-studio-agent
npm run verify:embedded -- --exe TaxamiStudioAgent.exe                          # script == tag
```

## After the release

- **Record:** the GitHub release (notes from the tag annotation, with the included PRs) and its three
  attested assets.
- **Light sync** of `main` into `develop`, while `develop` exists: when
  `git rev-list origin/main..origin/develop` is empty, `git push origin origin/main:develop` is the whole
  sync; otherwise one ordinary merge commit on `develop`, never a rebase or a force-push. Complete when
  `git rev-list origin/develop..origin/main` is empty.

## Rollback

With an explicit via in that conversation: re-publish the previous release as the latest (or attach the
previous binary to a new tag); never move or delete a deployed tag. A wrong release gets a new version.

## Hotfix

The tag rule wins: a hotfix is a **fast lane of the same procedure**, never an exception. Order:

1. **Roll back first.** Re-publish the previous release as the latest (see Rollback), so users can
   install a working build while the real fix is prepared.
2. **Fast lane.** PR **from `main`**, `.exe` built and tested, merged
   with its own via, **patch release** with the tag on that merge commit, then publish the release as
   above. The fix PR may carry the bump. A tag is **never** created on a hotfix branch.
3. **Break-glass** only when 1 and 2 are impossible (for example GitHub or the Actions quota is down)
   and the approver explicitly authorizes it naming "break-glass": the commit is on a branch on
   GitHub, the worktree is clean, the published asset reports that commit (`BUILD_COMMIT`), and the
   release notes mark the build **UNTAGGED**. Reconcile the same day with a PR, merge, tag and a
   re-published release.

After every hotfix, run the light sync as after every release (above).

## Out of scope

There is no preview or `develop` deployment for this component.
