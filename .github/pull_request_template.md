## What

<!-- One or two sentences on what this PR changes. -->

## Why

<!-- Link the spec section, design screen or issue. Note any departure from the Day 5 Designathon design (also add it to the README). -->

## How to test

1.

## Checklist

- [ ] `pnpm lint && pnpm typecheck && pnpm test` pass
- [ ] Schema changed → ran `pnpm db:generate` and committed the migration
- [ ] New env var → added to `.env.example` and `env.schema.ts`
- [ ] State changes write an audit event (with a reason where required)
- [ ] Driver/loader screens checked at phone width
- [ ] Docs updated (`docs/`, README walkthrough) if behaviour changed
