import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { collectDefaultMetrics, register } from 'prom-client';
import { AllowAnonymous } from '../core/http/decorators';

collectDefaultMetrics({ prefix: 'waypoint_' });

/** Prometheus scrape target (see deploy/observability/prometheus.yml). */
@ApiExcludeController()
@AllowAnonymous()
@Controller('metrics')
export class MetricsController {
  @Get()
  @Header('Content-Type', register.contentType)
  metrics() {
    return register.metrics();
  }
}
