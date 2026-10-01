# 3. Local object storage runs on Garage

Date: 2026-10-02 · Status: accepted

## Context
Proof of delivery (photos, signatures) goes to object storage behind short-lived signed URLs, so every environment needs an S3 API. Production uses Supabase Storage; locally we used MinIO. The `minio/minio` and `minio/mc` images no longer pull, which broke `docker compose up` for everyone, including judges — and `api` waited on `minio-init`, so nothing started.

We need storage that is S3-compatible enough for SigV4 presigned URLs, pulls reliably on `amd64` and `arm64`, and sets itself up with no external keys.

## Decision
Local object storage is **Garage** (`dxflrs/garage`), one node with `replication_factor = 1`:

- `deploy/s3/garage.toml` configures it. Secrets stay out of the file: Compose passes `GARAGE_RPC_SECRET` and `GARAGE_ADMIN_TOKEN` as environment variables.
- `s3-init` runs `deploy/s3/garage-init.mjs` (Node, no dependencies) against Garage's admin API: it applies the single-node layout, imports the S3 key from `.env`, creates the private `pod` bucket, grants the key access, then signs a request to prove the credentials work. It is idempotent, so it runs on every `docker compose up`.
- The S3 API is published on `9000`, the admin API on `9001`. The API still talks plain S3 (`S3_*` variables), so nothing above the adapter knows which implementation is running.

Rejected: **SeaweedFS** (S3 is one role of a larger filer stack; more surface than we need), **LocalStack** (a mock, ~1 GB image, and persistence is a paid feature), **Zenko CloudServer** (heavier image, less active), and a MinIO fork or an older tag (the pull problem is the point).

## Consequences
- `S3_SECRET_ACCESS_KEY` must be at least 16 characters; Garage rejects shorter secrets. The default is now `waypoint-dev-secret`, so an existing `.env` needs updating.
- Garage reserves an access key ID permanently, even after deletion, and cannot change a key's secret. Rotating locally means a new `S3_ACCESS_KEY_ID`, or dropping the two storage volumes (`docker compose rm -sf s3 s3-init && docker volume rm waypoint_s3meta waypoint_s3data`, which leaves the database alone); `s3-init` fails with that advice when the secret no longer matches.
- There is no web console. The admin API answers `GET /health`, and POD files are visible in the app.
- `S3_REGION` must match `s3_region` in `deploy/s3/garage.toml`, because SigV4 signs over the region.
- Production is unchanged: Supabase Storage over the same S3 API.
