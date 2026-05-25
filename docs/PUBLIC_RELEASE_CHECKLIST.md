# Public Release Checklist

Use this before publishing a public release.

## Required

- [ ] `npm run check` passes locally.
- [ ] GitHub Actions CI passes on `main`.
- [ ] README explains what the project does in the first screen.
- [ ] README quick start works from a fresh install.
- [ ] `npm pack --dry-run --cache .npm-cache` includes expected files.
- [ ] No `.tokentrace/` run artifacts are tracked.
- [ ] No secrets, tokens, private prompts, or private run transcripts are tracked.
- [ ] `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `LICENSE` exist.

## Nice To Have

- [ ] Dashboard screenshots are current.
- [ ] Add one fixture from a sanitized real Codex JSON run.
- [ ] Reserve or publish the npm package name.
- [ ] Add a first GitHub release after npm publishing.

## Launch Command

When ready:

```bash
git push origin main --tags
npm publish --access public
```
