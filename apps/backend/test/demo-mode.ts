/**
 * Import this first in a suite that needs DEMO_MODE=true (time travel, demo
 * reset). AppConfig reads the environment when app.module.ts is imported,
 * so it must run before create-test-app. The demo clock starts real.
 */
process.env.DEMO_MODE = 'true';
process.env.DEMO_CLOCK = '';
