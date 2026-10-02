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
// The suites never reach a real object store: a developer's .env may point at
// Garage, but a test must not depend on a bucket being up, initialised and
// writable. Clearing the keys picks LocalStorageAdapter, the keyless default,
// which signs URLs with the expiry the API asked for and stores nothing.
// Point TEST_S3_ENDPOINT at a real store to exercise S3StorageAdapter instead.
// Blanking the keys is what picks the local adapter, and it survives the
// .env file: dotenv fills a variable that is unset, never one already set.
if (process.env.TEST_S3_ENDPOINT) {
  process.env.S3_ENDPOINT = process.env.TEST_S3_ENDPOINT;
} else {
  process.env.S3_ACCESS_KEY_ID = '';
  process.env.S3_SECRET_ACCESS_KEY = '';
}
// Demo mode is off in tests unless a suite imports test/demo-mode.ts first,
// whatever a developer's .env says.
process.env.DEMO_MODE ??= 'false';
