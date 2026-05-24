# Public Release Checklist

Use this before changing the GitHub repository visibility to public.

## Required

- [ ] `npm run check` passes locally.
- [ ] GitHub Actions CI passes on `main`.
- [ ] README explains what the project does in the first screen.
- [ ] README quick start works from a fresh clone.
- [ ] `npm pack --dry-run --cache .npm-cache` includes expected files.
- [ ] No `.afr/` run artifacts are tracked.
- [ ] No secrets, tokens, private prompts, or private run transcripts are tracked.
- [ ] `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `LICENSE` exist.

## Nice To Have

- [ ] Add a screenshot or short GIF of `report.html`.
- [ ] Add one fixture from a sanitized real Codex JSON run.
- [ ] Reserve or publish the npm package name.
- [ ] Add a first GitHub release after npm publishing.

## Launch Command

When ready:

```bash
gh repo edit 12122J/agent-flight-recorder --visibility public
```
