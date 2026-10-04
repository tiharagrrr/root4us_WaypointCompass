import { bucket, defineRailway, github, postgres, preserve, project, redis, service, volume } from "railway/iac";

export default defineRailway(() => {
  const root4us_WaypointCompass = github("tiharagrrr/root4us_WaypointCompass", { checkSuites: false });

  const Postgres = postgres("Postgres", { region: "asia-southeast1-eqsg3a" });
  Postgres.networking = { privateNetworkEndpoint: "postgres" };
  const Redis = redis("Redis", { region: "asia-southeast1-eqsg3a" });
  Redis.deploy = { startCommand: "/bin/sh -c \"rm -rf $RAILWAY_VOLUME_MOUNT_PATH/lost+found/ && exec docker-entrypoint.sh redis-server --requirepass $REDIS_PASSWORD --save 60 1 --dir $RAILWAY_VOLUME_MOUNT_PATH\"" };
  Redis.networking = { privateNetworkEndpoint: "redis" };
  const postgresVolume = volume("postgres-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "asia-southeast1-eqsg3a", sizeMB: 500 });
  const redisVolume = volume("redis-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "asia-southeast1-eqsg3a", sizeMB: 500 });
  const durableCasket = bucket("durable-casket", { region: "sin" });
  const _waypointapi = service("@waypoint/api", {
    source: root4us_WaypointCompass,
    build: { buildCommand: "pnpm --filter @waypoint/api build", buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "/apps/backend/Dockerfile", watchPatterns: ["/apps/backend/**"] },
    start: "node dist/main.js",
    healthcheck: "/health/live",
    healthcheckTimeout: 60,
    preDeploy: "node dist/db/migrate.js",
    replicas: { "asia-southeast1-eqsg3a": 1 },
    deploy: { preDeployTimeoutSeconds: 600 },
    networking: { privateNetworkEndpoint: "waypointapi" },
    env: { ANTHROPIC_API_KEY: preserve(), API_PORT: preserve(), APP_URL: preserve(), BETTER_AUTH_SECRET: preserve(), COMPASS_APP_PASSWORD: preserve(), COMPASS_OWNER_PASSWORD: preserve(), COMPASS_READONLY_PASSWORD: preserve(), DATABASE_URL: preserve(), DIRECT_URL: preserve(), EMAIL_FROM: preserve(), EMAIL_PROVIDER: preserve(), GARAGE_ADMIN_TOKEN: preserve(), GARAGE_RPC_SECRET: preserve(), LLM_API_KEY: preserve(), LLM_BASE_URL: preserve(), LLM_MODEL: preserve(), LLM_PROVIDER: preserve(), POSTGRES_DB: preserve(), POSTGRES_PASSWORD: preserve(), POSTGRES_PORT: preserve(), POSTGRES_USER: preserve(), REDIS_PORT: preserve(), REDIS_URL: preserve(), RESEND_API_KEY: preserve(), S3_ACCESS_KEY_ID: preserve(), S3_ADMIN_PORT: preserve(), S3_BUCKET: preserve(), S3_ENDPOINT: preserve(), S3_FORCE_PATH_STYLE: preserve(), S3_PORT: preserve(), S3_REGION: preserve(), S3_SECRET_ACCESS_KEY: preserve(), SEED_DISPATCHER_USERNAME: preserve(), SEED_DRIVER_USERNAME: preserve(), SEED_LOADER_USERNAME: preserve(), SEED_PASSWORD: preserve(), SEED_STORE_MANAGER_USERNAME: preserve(), SEED_USER_PASSWORD: preserve(), SESSION_EXPIRES_IN_DAYS: preserve(), SIMULATION_ENABLED: preserve(), SITE_ADDRESS: preserve(), WEB_PORT: preserve() },
  });
  const _waypointfrontend = service("@waypoint/frontend", {
    source: root4us_WaypointCompass,
    build: { buildCommand: "pnpm --filter @waypoint/frontend build", buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "apps/frontend/Dockerfile", watchPatterns: ["/apps/frontend/**"] },
    start: "caddy run --config /etc/caddy/Caddyfile --adapter caddyfile",
    replicas: { "asia-southeast1-eqsg3a": 1 },
    networking: { privateNetworkEndpoint: "waypointfrontend" },
    env: { API_UPSTREAM: preserve(), PORT: preserve(), SITE_ADDRESS: preserve(), VITE_API_BASE: preserve() },
  });

  return project("rare-heart", {
    resources: [_waypointapi, _waypointfrontend, Postgres, Redis, postgresVolume, redisVolume, durableCasket],
  });
});
