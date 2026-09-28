import { resolve } from 'node:path';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './env.schema';

/** Reads apps/backend/.env, then the repo-root .env; real env vars win. */
export const AppConfigModule = ConfigModule.forRoot({
  isGlobal: true,
  cache: true,
  envFilePath: [resolve(process.cwd(), '.env'), resolve(__dirname, '../../../../.env')],
  validate: validateEnv,
});
