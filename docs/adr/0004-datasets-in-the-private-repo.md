# 4. Keep the competition datasets in the private repo

Date: 2026-10-04 · Status: accepted

## Context
The seed reads the challenge CSVs from `SEED_DATA_DIR`, defaulting to the repository's own seed data
folder. Those files were git-ignored, which kept them off GitHub but also kept them out of every
build context. Compose works around it by mounting the folder from the host; Railway cannot, so the
deployed image held none of them and the pre-deploy seed skipped everything dataset-derived:

```
[seed] outlets.csv not found in /repo/data/seed; skipping
[seed] reference data: 0 depots, 0 districts, 0 outlets, 0 vehicles, 0 calendar days, ...
[seed] 6 persona accounts, 0 dock devices
[seed] task2b_peak_day_scenarios.csv not found in /repo/data/seed; no demo day
```

Sign-in worked, because the persona accounts come from `SEED_*` environment variables, but outlets,
depots, vehicles, travel times and the demo day were all absent from the live demo.

The alternatives were seeding over an SSH tunnel from a machine that has the files, or mounting them
from a Railway volume. Both leave a manual step that has to be repeated for every fresh environment,
and neither survives a database reset without someone remembering to do it again.

## Decision
The CSVs are tracked in this repository, which is private. The terms forbid publishing or sharing
the datasets; keeping them in a private repo is neither, so the constraint that matters is that the
repo stays private and nothing is copied out of it.

Two things deliberately do not change:

- **Agents still must not open, search or copy the files.** `.claude/hooks/protect-data.mjs` and the
  "Never" rule in `CLAUDE.md` and `AGENTS.md` stay exactly as they were. Tracking a file does not
  require an agent to read it, and `specs/data/datasets.md` remains the source for columns.
- **`datathon/data/` stays ignored.** Only what the seed needs is tracked.

## Consequences
A clone and a deploy both seed themselves, with no tunnel, no volume and no manual step, and a
database reset is recoverable by redeploying.

The repo must stay private. If it is ever made public, or the datasets are redistributed, that is a
breach of the terms, and removing them later means a history rewrite rather than a revert.

ROO-12 asked the organisers how judges should get access to a private repo and whether the terms
allow this, and was closed without an answer. That question is now load-bearing: confirm it before
submission. If the answer is no, this is reverted with `git rm --cached` plus a history rewrite.

Every built image carries the datasets, because the backend Dockerfile copies the seed data folder.
Image registries holding them are subject to the same privacy requirement as the repo.
