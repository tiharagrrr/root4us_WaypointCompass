// Imported first by openapi.ts: env validation runs when app.module.ts is
// imported, and the preview build connects to nothing, so placeholders do.
process.env.DATABASE_URL ||= 'postgres://openapi@localhost:1/openapi';
process.env.REDIS_URL ||= 'redis://localhost:1';
process.env.BETTER_AUTH_SECRET ||= 'openapi-only-secret-with-32-characters';
