/**
 * Import first, like test/demo-mode: AppConfig reads the environment when
 * app.module.ts is imported. A test-only Resend signing secret, so the suite
 * can sign webhooks the way Resend does.
 */
export const TEST_WEBHOOK_SECRET = `whsec_${Buffer.from('waypoint-test-webhook-secret').toString('base64')}`;
process.env.RESEND_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
