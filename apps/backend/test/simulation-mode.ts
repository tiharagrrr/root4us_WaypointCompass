/**
 * Import this first in a suite that needs the simulator: demo mode, the
 * simulator's flag and the keyless scripted model. Like test/demo-mode.ts it
 * must run before create-test-app, because AppConfig reads the environment
 * when app.module.ts is imported.
 */
process.env.DEMO_MODE = 'true';
process.env.DEMO_CLOCK = '';
process.env.SIMULATION_ENABLED = 'true';
process.env.LLM_PROVIDER = 'scripted';
