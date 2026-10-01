import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker/worker.module';

async function bootstrap() {
  // Read by AppConfig.appName: the worker's log lines say app=worker.
  process.env.WAYPOINT_PROCESS = 'worker';
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.get(Logger).log('Worker started', 'Bootstrap');
}
void bootstrap();
