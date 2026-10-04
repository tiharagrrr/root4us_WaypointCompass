import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.schema';

export type ProcessRole = 'api' | 'worker';

/**
 * Typed configuration in groups, so no module reads process.env or a raw
 * ConfigService key. Values are validated once at boot by env.schema.ts.
 */
@Injectable()
export class AppConfig {
  constructor(private readonly config: ConfigService<Env, true>) {}

  private get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  get env(): Env['NODE_ENV'] {
    return this.get('NODE_ENV');
  }

  get isDev(): boolean {
    return this.env === 'development';
  }

  get isTest(): boolean {
    return this.env === 'test';
  }

  /** Which entry point is running; worker.ts sets WAYPOINT_PROCESS=worker before it boots. */
  get appName(): ProcessRole {
    return process.env.WAYPOINT_PROCESS === 'worker' ? 'worker' : 'api';
  }

  get version(): string {
    return this.get('APP_VERSION');
  }

  get port(): number {
    return this.get('PORT');
  }

  get appUrl(): string {
    return this.get('APP_URL');
  }

  get log() {
    const fallback = this.isDev ? 'debug' : this.isTest ? 'error' : 'info';
    return { level: this.get('LOG_LEVEL') ?? fallback };
  }

  get db() {
    return { url: this.get('DATABASE_URL') };
  }

  get redis() {
    return { url: this.get('REDIS_URL') };
  }

  get auth() {
    return {
      secret: this.get('BETTER_AUTH_SECRET'),
      trustedOrigins: this.get('TRUSTED_ORIGINS'),
      enableBearer: this.get('ENABLE_BEARER'),
    };
  }

  get storage() {
    return {
      endpoint: this.get('S3_ENDPOINT'),
      region: this.get('S3_REGION'),
      bucket: this.get('S3_BUCKET'),
      accessKeyId: this.get('S3_ACCESS_KEY_ID'),
      secretAccessKey: this.get('S3_SECRET_ACCESS_KEY'),
      forcePathStyle: this.get('S3_FORCE_PATH_STYLE'),
    };
  }

  /** Demo mode turns on time travel, the demo inbox and the demo-day reset. */
  get demo() {
    return { enabled: this.get('DEMO_MODE'), clock: this.get('DEMO_CLOCK') };
  }

  /** The simulator runs only with this and demo mode both on. */
  get simulation() {
    return { enabled: this.get('SIMULATION_ENABLED') };
  }

  /**
   * Where SMS goes. `demo-inbox`, the default, needs no key and no account:
   * one variable swaps in a Sri Lankan gateway once its sender id is approved.
   */
  get sms() {
    return {
      provider: this.get('SMS_PROVIDER'),
      notifylk: {
        userId: this.get('NOTIFYLK_USER_ID'),
        apiKey: this.get('NOTIFYLK_API_KEY'),
        senderId: this.get('NOTIFYLK_SENDER_ID'),
      },
      textlk: {
        apiToken: this.get('TEXTLK_API_TOKEN'),
        senderId: this.get('TEXTLK_SENDER_ID'),
      },
      twilio: {
        accountSid: this.get('TWILIO_ACCOUNT_SID'),
        authToken: this.get('TWILIO_AUTH_TOKEN'),
        from: this.get('TWILIO_FROM'),
      },
    };
  }

  /** The scenario director's model; `disabled` means no model is ever called. */
  get llm() {
    return {
      provider: this.get('LLM_PROVIDER'),
      apiKey: this.get('ANTHROPIC_API_KEY'),
      model: this.get('LLM_MODEL'),
      openai: {
        baseUrl: this.get('LLM_BASE_URL'),
        apiKey: this.get('LLM_API_KEY'),
        model: this.get('LLM_MODEL'),
      },
    };
  }
}
