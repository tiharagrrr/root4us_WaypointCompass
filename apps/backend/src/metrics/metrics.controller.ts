import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { collectDefaultMetrics, register } from 'prom-client';

collectDefaultMetrics({ prefix: 'waypoint_' });

/** Prometheus scrape target (see deploy/observability/prometheus.yml). */
@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  @Get()
  @Header('Content-Type', register.contentType)
  metrics() {
    return register.metrics();
  }
}
