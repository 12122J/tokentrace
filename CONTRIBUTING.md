# Contributing

Thanks for helping make coding-agent runs easier to inspect and trust.

## Development

```bash
npm run check
node bin/afr.mjs run -- node -e "console.log('sample')"
node bin/afr.mjs summarize
```

The project has no runtime dependencies. Keep new dependencies rare and
well-justified.

## Design Guidelines

- Preserve local-first behavior.
- Keep artifacts portable and human-inspectable.
- Record failed runs as carefully as successful ones.
- Prefer adapter-specific parsing over agent-specific core behavior.
- Add tests for every new event shape or warning.

## Pull Requests

Please include:

- what changed
- why it changed
- how you tested it
- sample output when changing reports or CLI behavior

## Commit Style

Use short conventional-ish messages:

```text
feat: add claude adapter
fix: include untracked files in diff summary
docs: document run format
```
