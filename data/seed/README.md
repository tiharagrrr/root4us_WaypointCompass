# Seed data

The `seed` service loads these shared challenge datasets on every `docker compose up` (idempotent upsert):

| File | Required | Loaded into |
| --- | --- | --- |
| `outlets.csv` | yes | `depot`, `outlet` |
| `vehicles.csv` | yes | `depot`, `vehicle` |
| `calendar.csv` | yes | `calendar_day` |
| `district_travel.csv` | for planning | `district_travel` |
| `service_allowance.csv` | for planning | `service_allowance` |

Copy the files from the organisers' dataset (`General Data/`) into this folder. Missing files are skipped with a warning, so the stack still starts.

> **Confidentiality.** The competition terms forbid sharing or publishing the datasets. These CSVs are committed so `docker compose up` works on a fresh clone, which means **the repository must stay private** (grant judges access) unless the organisers confirm otherwise (tech-triathlon@rootcode.io). If the repo has to be public, add `data/seed/*.csv` to `.gitignore` and document where judges get the files.
