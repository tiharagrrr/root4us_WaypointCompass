---
description: Regenerate openapi.json and the API client, review the contract diff, update MSW live.ts
---
Keep the OpenAPI contract, the generated client and the MSW pass-through list in step.

1. Run `pnpm api:gen`. It writes apps/backend/openapi.json and regenerates packages/api-client.
   If it fails, fix the controller or DTO that broke it; never edit packages/api-client/src/gen.
2. Review `git diff -- apps/backend/openapi.json`. List every change under one of:
   - Added (new paths, operations, optional fields): fine.
   - Breaking: a removed path, operation or response field; a renamed field; a changed type or
     enum value; a request field that became required; a changed status code or problem code.
   For each breaking change, say whether the branch meant it and which screens or modules use it
   (search apps/frontend/src for the generated hook name). Stop and ask before keeping an unintended one.
3. Update apps/frontend/src/mocks/live.ts: add each path whose endpoint is now implemented (not a 501
   stub), so MSW passes it through to the API. Remove none unless the endpoint was removed.
4. Run `pnpm --filter frontend typecheck` so screens that use a changed hook fail now, not in review.
5. Reply with: added, breaking (intended or not), live.ts changes, and typecheck result.
