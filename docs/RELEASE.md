# GitHub releases

The standalone export is the single source of truth for `.github/workflows/ci.yml`
and `release.yml`. Both are explicitly exported along with MCP sources. Other
public workflows are preserved. Never copy the parent application or its Git history
into this repository. Installation packages contain only compiled MCP code,
package metadata, public documentation, examples and third-party license texts.

## Validation and release behavior

CI runs for pushes and pull requests, using Node.js 22 and 24 on Ubuntu, Windows
and macOS. It runs `npm ci --ignore-scripts`, `npm test`, `npm run build`, dependency
source/license checks, schema and notice drift checks, `npm run check:release`
and a package dry run. All Actions use pinned commit SHAs from GitHub's `actions`
organization. Checkouts do not persist credentials.

Release runs for pushed `v*` tags or a manual `workflow_dispatch` with an existing
`tag` input. The updated workflow runs from the selected branch, while version
validation resolves `refs/tags/<tag>` to an exact commit; all six CI combinations
and packaging check out that same commit, preserving the published source version. The tag must exactly equal `v` followed by
`package.json.version`; both root versions in `package-lock.json` must match.
After the same six CI combinations pass, a read-only job rebuilds, tests, checks
licenses and the release boundary, then creates:

- `chemdatadoctor-mcp-<version>.tgz`: an installation archive created by `npm pack`.
- `SHA256SUMS`: the SHA-256 checksum of that archive.

The package inventory is validated before upload. Only the final job has
`contents: write`; it downloads those assets, checks their SHA-256 and uses the
official GitHub CLI to query the target Release first. Only HTTP 404 permits
creation with `--verify-tag`; other API failures stop publication. Tags containing
a prerelease suffix create a prerelease. Existing Releases retain their title,
notes and settings. For each expected asset, including `SHA256SUMS`, the workflow
downloads any same-name file and compares its SHA-256 against the local file.
Identical files are skipped; any mismatch fails before uploading missing files.
Missing assets are uploaded without overwrite and downloaded again for verification.
Reruns can repair interrupted uploads. Runs targeting the same tag are serialized.

No npm publication occurs. `npm pack` only creates a local archive. A future npm
publishing workflow requires a separate decision and configuration.

## First release: v0.1.0

1. Have a maintainer enable Actions in the public repository. Ensure organization
   policies allow the pinned official Actions, reusable workflows and a job-level
   `contents: write` grant. No public repository secret or npm token is needed.
2. In the source repository, commit and merge the reviewed export, allowlist and
   sync workflow changes. For source synchronization only, update the existing
   fine-grained sync token to permit Workflows read/write in addition to Contents
   and Pull requests read/write on this public repository. Keep this token in the
   existing private sync environment; never add it to public Release jobs.
3. Run the existing source sync in `verify` mode, then `pull-request` mode. Review
   the public PR, including both workflow files, and wait for all six CI checks.
   Merge the PR into public `main` using the normal review process.
4. After the owner approves the release, use a separate checkout of the **public**
   repository. Confirm the remote before creating a tag:

   ```sh
   git clone https://github.com/chemaiatlas/chemdatadoctor-mcp.git
   cd chemdatadoctor-mcp
   git remote -v
   git switch main
   git pull --ff-only origin main
   git status --short
   node -p "require('./package.json').version"
   git ls-remote --tags origin refs/tags/v0.1.0
   ```

   Require a clean tree, version `0.1.0`, successful CI for this commit, no existing
   `v0.1.0` tag, and no existing `v0.1.0` Release in the GitHub Releases page.
5. With that approval, create and push the tag from this public checkout:

   ```sh
   git tag -a v0.1.0 -m "ChemDataDoctor MCP v0.1.0"
   git push origin refs/tags/v0.1.0
   ```

   The tag push authorizes the configured automatic Release. Do not tag or push
   the parent source repository for this operation. If using a token to push,
   use a maintainer credential that triggers workflows; pushes by a workflow's
   default `GITHUB_TOKEN` do not trigger another push workflow.
6. Watch Actions → Release. Require version, validation, package and publish jobs
   to succeed. Confirm both assets on Releases → v0.1.0 and download them:

   ```sh
   shasum -a 256 -c SHA256SUMS
   npm install --ignore-scripts ./chemdatadoctor-mcp-0.1.0.tgz
   node node_modules/chemdatadoctor-mcp/dist/cli.js --data-root /absolute/path/to/data
   ```

   Use an existing dedicated data directory. The CLI waits for an MCP client on
   stdin. The archive includes compiled code; installation fetches dependencies,
   and runtime cleaning remains local and offline. Source archives generated by
   GitHub are also available on the Release page.

## Repair assets on the existing v0.1.0 Release

1. Review and merge these workflow changes through the normal source sync PR
   process above, keeping the maintained export and public workflows in sync.
   Do not move/recreate the existing tag or delete/recreate its Release.
2. Open the public repository **Actions → Release → Run workflow**. Select
   **main** (containing the reviewed workflow fix), enter **v0.1.0** in the `tag`
   field, and run. Do not select the old tag as the workflow branch: it still
   contains the original workflow. Do not use “Re-run jobs” on the original
   failed run, which uses the old workflow revision.
3. The workflow builds the unchanged v0.1.0 tag after the full validation matrix.
   The publish job reuses the existing Release and adds
   `chemdatadoctor-mcp-0.1.0.tgz` and `SHA256SUMS` using only its default
   `GITHUB_TOKEN` (`contents: write`). No PAT or npm token is needed.
4. Confirm both assets at Releases → v0.1.0, download them into an empty
   directory, and run `shasum -a 256 -c SHA256SUMS` (or
   `sha256sum --check SHA256SUMS` on Linux). If interrupted, run the updated
   workflow again with the same tag to fill missing assets. If a same-name
   file has different bytes, investigate the build/artifact provenance; the
   workflow deliberately fails and never replaces it.

## Permissions to configure manually

- Public repository: enable Actions and allow the pinned official Actions and
  reusable workflow. Keep the default workflow token read-only; allow this
  workflow's explicit publish-job `contents: write`. No PAT is used for Releases.
- Source sync: existing private environment secret needs Workflows read/write
  because it now updates exactly two workflow files. Restrict it to this public
  repository, retain the existing review gate, and obtain organization approval
  if required. No Actions, Secrets or Administration permission is needed.
- Maintainer: needs permission to merge the sync PR and push a `v*` tag. Review
  tag rulesets and release policies so they allow the intended maintainer and
  `GITHUB_TOKEN` release creation. Do not grant the sync identity bypass rights.

Official references: [GitHub token permissions](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token)
and [GitHub CLI release creation](https://cli.github.com/manual/gh_release_create).
