// Prepares the local Garage node for the API, through Garage's admin API:
// a single-node cluster layout, the private POD bucket, and the S3 key the API
// signs its URLs with. Idempotent: it runs on every `docker compose up`, and
// the values in .env always win.
//
// Run by the `s3-init` service (node:22-alpine, no dependencies).

import { createHash, createHmac } from 'node:crypto';

const adminUrl = (process.env.GARAGE_ADMIN_URL ?? 'http://s3:3903').replace(/\/$/, '');
const adminToken = required('GARAGE_ADMIN_TOKEN');
const bucket = process.env.S3_BUCKET ?? 'pod';
const accessKeyId = required('S3_ACCESS_KEY_ID');
const secretAccessKey = required('S3_SECRET_ACCESS_KEY');
const s3Endpoint = (process.env.S3_ENDPOINT ?? 'http://s3:3900').replace(/\/$/, '');
const s3Region = process.env.S3_REGION ?? 'us-east-1';
const zone = process.env.GARAGE_ZONE ?? 'local';
const capacityBytes = Number(process.env.GARAGE_CAPACITY_BYTES ?? 10_000_000_000);

// Garage rejects shorter secrets; fail with the file to fix rather than its error.
if (secretAccessKey.length < 16) {
  fail(
    'S3_SECRET_ACCESS_KEY must be at least 16 characters (Garage rejects shorter ' +
      `keys); it is ${secretAccessKey.length}. Fix it in .env.`,
  );
}

function required(name) {
  const value = process.env[name];
  if (!value) fail(`${name} is not set.`);
  return value;
}

function fail(message) {
  console.error(`s3-init: ${message}`);
  process.exit(1);
}

function log(message) {
  console.log(`s3-init: ${message}`);
}

/** Calls an admin API v2 endpoint, e.g. api('GET', 'GetClusterStatus'). */
async function api(method, endpoint, { query, body } = {}) {
  const url = new URL(`${adminUrl}/v2/${endpoint}`);
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${adminToken}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, ok: res.ok, body: parsed };
}

async function expect(method, endpoint, options) {
  const res = await api(method, endpoint, options);
  if (!res.ok) fail(`${endpoint} failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body;
}

async function retry(what, attempt, { attempts = 60, delayMs = 1000 } = {}) {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      if (await attempt()) return;
    } catch {
      // Not up yet.
    }
    if (i === attempts) fail(`timed out waiting for ${what}.`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

/** /health is unauthenticated: 503 while the node has no layout, 200 once usable. */
async function healthStatus() {
  const res = await fetch(`${adminUrl}/health`);
  return res.status;
}

async function ensureLayout() {
  const layout = await expect('GET', 'GetClusterLayout');
  if (layout.version > 0) {
    log(`cluster layout already at version ${layout.version}.`);
    return;
  }
  const status = await expect('GET', 'GetClusterStatus');
  const node = status.nodes.find((n) => n.isUp);
  if (!node) fail('the Garage node is not up yet.');
  log(`assigning node ${node.id.slice(0, 16)} to zone ${zone} with ${capacityBytes} bytes.`);
  await expect('POST', 'UpdateClusterLayout', {
    body: { roles: [{ id: node.id, zone, capacity: capacityBytes, tags: [] }] },
  });
  await expect('POST', 'ApplyClusterLayout', { body: { version: layout.version + 1 } });
  await retry('the cluster to become healthy', async () => (await healthStatus()) === 200);
  log('cluster layout applied.');
}

async function ensureKey() {
  const imported = await api('POST', 'ImportKey', {
    body: { accessKeyId, secretAccessKey, name: accessKeyId },
  });
  if (imported.ok) {
    log(`imported S3 key ${accessKeyId}.`);
    return;
  }
  if (imported.status !== 409) {
    fail(`ImportKey failed (${imported.status}): ${JSON.stringify(imported.body)}`);
  }
  // Garage reserves a key ID for good, even once deleted, so the secret stored
  // on first start cannot be replaced. verifySignedAccess() below reports
  // whether it still matches S3_SECRET_ACCESS_KEY.
  log(`S3 key ${accessKeyId} already exists; keeping the secret it was created with.`);
}

async function ensureBucket() {
  const created = await api('POST', 'CreateBucket', { body: { globalAlias: bucket } });
  if (created.ok) {
    log(`created bucket ${bucket} (private).`);
    return created.body.id;
  }
  if (created.body?.code !== 'BucketAlreadyExists') {
    fail(`CreateBucket failed (${created.status}): ${JSON.stringify(created.body)}`);
  }
  const info = await expect('GET', 'GetBucketInfo', { query: { globalAlias: bucket } });
  log(`bucket ${bucket} already exists.`);
  return info.id;
}

/**
 * Lists the bucket with the credentials from .env, signed the way the API signs.
 * A secret that no longer matches the stored key fails here, with the fix,
 * instead of as a 403 inside the API when a driver uploads proof of delivery.
 */
async function verifySignedAccess() {
  const url = new URL(`${s3Endpoint}/${bucket}`);
  const query = 'list-type=2&max-keys=0';
  const amzDate = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const payloadHash = createHash('sha256').update('').digest('hex');
  const canonicalRequest = [
    'GET',
    url.pathname,
    query,
    `host:${url.host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
    '',
    'host;x-amz-content-sha256;x-amz-date',
    payloadHash,
  ].join('\n');
  const scope = `${date}/${s3Region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');
  let signingKey = Buffer.from(`AWS4${secretAccessKey}`);
  for (const part of [date, s3Region, 's3', 'aws4_request']) {
    signingKey = createHmac('sha256', signingKey).update(part).digest();
  }
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  const res = await fetch(`${url}?${query}`, {
    headers: {
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
      authorization:
        `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, ` +
        `SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`,
    },
  });
  if (res.ok) return;
  const body = (await res.text()).replace(/\s+/g, ' ').slice(0, 200);
  if (res.status === 403) {
    fail(
      `signed request to ${bucket} was refused (403): ${body}\n` +
        '  Either S3_REGION no longer matches s3_region in deploy/s3/garage.toml, or the stored\n' +
        `  key ${accessKeyId} was created with a different secret, which Garage cannot change.\n` +
        '  Fix .env, or set a new S3_ACCESS_KEY_ID, or reset storage alone (this keeps the\n' +
        '  database): docker compose rm -sf s3 s3-init && docker volume rm waypoint_s3meta waypoint_s3data',
    );
  }
  fail(`signed request to ${bucket} failed (${res.status}): ${body}`);
}

await retry(`the Garage admin API on ${adminUrl}`, async () => (await healthStatus()) > 0);
await ensureLayout();
await ensureKey();
const bucketId = await ensureBucket();
await expect('POST', 'AllowBucketKey', {
  body: {
    bucketId,
    accessKeyId,
    permissions: { read: true, write: true, owner: true },
  },
});
await verifySignedAccess();
log(`key ${accessKeyId} can read and write ${bucket}. Storage is ready.`);
