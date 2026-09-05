# Release

Releases are GitHub releases with the npm tarball attached; nothing is published to npm (the `patchright-cli` npm name belongs to an unrelated project). Versioning is independent 0.x semver: patch for rolls without behavior change, minor for new commands or changed stealth defaults.

## Steps

1. `main` is green in CI and `node bin/patchright-cli.js selftest` passes locally.
2. Move the `Unreleased` section of `CHANGELOG.md` to `## [x.y.z] - YYYY-MM-DD`; keep an `Upstream:` line naming the `patchright-core` version and the Playwright version it patches.
3. Bump the version and commit:
   ```bash
   npm version --no-git-tag-version x.y.z
   git commit -am "chore: mark vx.y.z"
   ```
   Open a PR, merge it.
4. Tag and push:
   ```bash
   git tag -a vx.y.z -m "patchright-cli vx.y.z"
   git push origin vx.y.z
   ```
5. Create the release from the changelog section; the `Release` workflow verifies the tag against `package.json`, packs and attaches `b1zya-patchright-cli-x.y.z.tgz`:
   ```bash
   gh release create vx.y.z --title "patchright-cli vx.y.z" --notes-file <(sed -n '/^## \[x.y.z\]/,/^## \[/p' CHANGELOG.md | sed '$d')
   ```
6. Install instructions to quote in the notes: `npm i -g github:b1zya/patchright-cli#vx.y.z` or the tarball URL from the release assets.
