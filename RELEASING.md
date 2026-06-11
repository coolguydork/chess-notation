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
is published):

1. Read the [submission requirements](https://docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins)
   and [plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines).
2. Fork [obsidianmd/obsidian-releases](https://github.com/obsidianmd/obsidian-releases)
   and append an entry to the **end** of `community-plugins.json`:

   ```json
   {
     "id": "chess-notation",
     "name": "Chess Notation",
     "author": "coolguydork",
     "description": "Render and interact with chess boards inside your notes using FEN or PGN notation.",
     "repo": "coolguydork/chess-notation"
   }
   ```

   `id`, `name`, `author`, and `description` must match `manifest.json` exactly.
3. Open a PR using their plugin template and complete its checklist.
4. An automated review bot scans the code first; address its comments, then a
   human review follows. Once merged, the plugin appears in Community plugins
   and updates ship automatically from new GitHub releases — no further PRs
   needed.
