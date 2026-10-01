/**
 * Jest setupFiles: runs before each test file's imports, because ConfigModule
 * reads the environment when app.module.ts is imported. The e2e suites run
 * only when TEST_DATABASE_URL and TEST_DIRECT_URL point at a migrated local
 * database (see createTestApp); TEST_REDIS_URL picks the Redis they use.
 */
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
} else {
  // The e2e suites skip, but importing AppModule still validates the
  // environment. Nothing connects to these.
  process.env.DATABASE_URL ||= 'postgres://unused@localhost:1/unused';
  process.env.REDIS_URL ||= 'redis://localhost:1';
}
if (process.env.TEST_REDIS_URL) {
  process.env.REDIS_URL = process.env.TEST_REDIS_URL;
}
process.env.BETTER_AUTH_SECRET ??= 'test-only-secret-with-at-least-32-chars';
// Demo mode is off in tests unless a suite imports test/demo-mode.ts first,
// whatever a developer's .env says.
process.env.DEMO_MODE ??= 'false';
