# Releasing

## Cutting a release

1. **Bump the version** (semver, no `v` prefix anywhere):
   - `manifest.json` → `version`
   - `package.json` → `version`
   - `versions.json` → add `"<new version>": "<minAppVersion>"` (only needs a
     new line when `minAppVersion` changes, but adding one per release is fine)
2. Commit, merge to `main`, push.
3. Tag and push the tag — **the tag must equal `manifest.json`'s `version`
   exactly** (CI verifies and fails the release otherwise):

   ```bash
   git tag 0.1.0
   git push origin 0.1.0
   ```

4. The release workflow (`.github/workflows/release.yml`) builds the plugin and
   creates a **draft** GitHub release with `main.js`, `styles.css`, and
   `manifest.json` attached as individual assets (required by Obsidian — not
   zipped).
5. Review the draft on GitHub, write release notes, and **publish** it.

## First-time submission to community plugins

One-time steps to get listed in Obsidian's directory (after the first release
is published). Submission goes through Obsidian's web portal — the old
fork-and-PR flow against `obsidianmd/obsidian-releases` was retired in 2026
(that repo has pull requests disabled).

1. Read the [submission requirements](https://docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins)
   and [plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines).
2. Go to [community.obsidian.md](https://community.obsidian.md), sign in with
   your Obsidian account, and link the GitHub account that owns this repo.
3. Select **Plugins → New plugin**, enter the repository URL
   (`https://github.com/coolguydork/chess-notation`), agree to the
   [developer policies](https://docs.obsidian.md/Developer+policies), and
   submit. The portal reads `manifest.json` from the default branch;
   downloads come from the release whose tag matches its `version`.
4. The portal runs an automated review; address feedback by fixing the code
   and publishing a new release with an incremented version. Once approved,
   the plugin appears in Community plugins and updates ship automatically
   from new GitHub releases.
