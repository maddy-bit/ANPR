# SIH26127 ? Repository Agent Rules

These rules apply to every coding agent working in this repository, including Google Antigravity.

## Source of truth and architecture
- The active application stack is the Next.js frontend in `frontend/`, Node.js/Express backend in `backend-node/`, Python/FastAPI AI service in `ai-service/`, and local PostgreSQL/PostGIS plus Redis.
- The Spring Boot application in `backend/` is legacy compatibility code. Do not remove, disable, rewrite, or migrate away from it until API/data parity is demonstrated and the project owner explicitly approves.
- Read the relevant implementation and tests before editing. Old audit reports, screenshots, benchmark reports, generated PDFs, and prior agent summaries are historical evidence, not proof of current behavior.
- Treat `PROJECT_AUDIT_REPORT/`, `docs/`, `scratch/`, `data/benchmarks/`, and test suites as useful context; verify each claim against current source and runtime.

## Data integrity ? non-negotiable
- Never fabricate a license plate, OCR result, vehicle identity, detection, coordinate, timestamp, speed, camera transition, confidence score, owner/RC field, blacklist state, challan status, model score, or evidence reference.
- Unknown or unavailable values must remain null/unknown/not provided. Do not replace missing values with plausible constants, sample data, defaults that look real, or synthetic coordinates.
- Every trajectory/identity link must preserve provenance and confidence. Distinguish a confirmed match from probable/unverified candidate associations. Do not silently promote a candidate to a confirmed identity.
- Use camera metadata coordinates only when the camera record supplies valid coordinates. Use observed timestamps from source metadata; never invent capture times.
- Persist and surface model name/version/dimension and processing-run identifiers when available.
- Label the bundled `videos/CAM-*.mp4` files as recorded/demo archives. Do not call them live CCTV. RTSP, ONVIF, or public-camera integrations require explicitly authorized source URLs and credentials from the owner.
- A third-party RapidAPI result is not an official government VAHAN response, official Form 23, digital signature, government verification key, RTO seal, proof of ownership, or challan clearance. Mark absent provider fields unknown and clearly label exported PDFs as unofficial provider lookup summaries.
- Mask personal owner information, address, chassis, and engine identifiers by default. Do not log provider API keys, tokens, credentials, full authorization headers, or sensitive personal fields.

## Safety and protected data
- Never read, print, copy, commit, or overwrite `.env`, `.env.*`, `.env.original_supabase_ref`, credentials, private keys, certificates, token files, browser profiles, database dumps, model weights, raw CCTV, or evidence data unless the owner explicitly requests the specific operation.
- Never connect to a remote/Supabase/cloud database. Use only the configured local PostgreSQL/PostGIS and local Redis.
- Never delete data, videos, evidence, model weights, volumes, backups, logs, or user-generated artifacts.
- Never run `docker compose down -v`, `docker volume rm`, `docker system prune`, database DROP/TRUNCATE, destructive migrations, or blanket cleanup commands.
- Do not install packages, update dependencies, start/stop/restart containers or host services, run database migrations, alter volumes, change firewall/network policy, commit, push, change branches/remotes, or remove legacy components without explicit owner approval.
- Preserve all pre-existing modified and untracked Git files. Do not use `git checkout --`, `git reset --hard`, `git clean`, or broad reformatters.

## Implementation quality
- Prefer small, reversible changes with focused regression tests. Avoid speculative rewrites or large refactors without a verified failing case.
- Keep backend, AI, and frontend contracts aligned. When changing request/response contracts, update schemas, tests, API clients, and mapping code together.
- Validate uploaded video contents by signature/container, not only filename or MIME type. Bound file sizes and clean temporary/orphaned files safely.
- Treat byte ranges, retries, idempotency, transactional outbox, Redis Streams, and processing-run state transitions as correctness-critical.
- Analytics must be computed from observed persisted data. Clearly show when sample sizes are zero or insufficient.
- Keep local host-run services loopback-bound by default. Container services may bind to 0.0.0.0 only inside the container network and must publish host ports on 127.0.0.1 unless the owner explicitly requests LAN access.
- Do not weaken auth/authorization or CORS to make a test pass. If local-only development routes are unauthenticated, document that limitation and keep them loopback-only.
- Never claim tests, deployment, camera connectivity, model inference, or third-party verification succeeded unless actually executed and observed.

## Required workflow
1. Inspect `git status --short` and relevant files before editing. Record the current branch and HEAD. Do not overwrite user changes.
2. Identify the exact failing behavior from code, tests, logs, or a reproducible read-only probe. Separate verified facts from hypotheses.
3. Make the smallest cohesive patch and add a regression test for the defect.
4. Run focused tests first, followed by relevant syntax/type/lint/build checks. Do not execute tests that mutate production/local DB state without approval.
5. Report modified files, checks actually run and their results, unresolved risks, and anything that requires a process restart or environment change.
6. Keep Docker infrastructure, database state, model artifacts, and evidence untouched unless the owner approves a separate operation.

## Project-specific constraints
- The project owner is preserving the existing working tree. Assume every uncommitted modification is intentional until proven otherwise.
- Do not delete the Spring Boot backend or the original Supabase reference file.
- If adding real camera connectivity, first design a credential-safe RTSP/ONVIF source registry with explicit authorization, health/status tracking, encrypted secrets, and a clear separation between recorded archives and live streams. Do not scrape, probe, or connect to public cameras without an authorized source.
