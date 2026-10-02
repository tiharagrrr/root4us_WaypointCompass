import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ApiPaginated, RequirePermission } from '../../../core/http/decorators';
import {
  CalendarRangeQueryDto,
  RoadConditionDto,
  ServiceAllowanceDto,
  TrafficSpeedDto,
} from '../dto/reference.dto';
import { plainList } from '../policies/whole-list';
import { ReferenceQueries } from '../services/reference.queries';

/**
 * The booklet's reference tables, read by the engine context and the admin
 * views: how long a stop takes, how fast a district moves by hour, and what
 * the roads were like on a day (AC-MD-11).
 */
@ApiTags('reference-data')
@Controller()
export class ReferenceController {
  constructor(private readonly reference: ReferenceQueries) {}

  @Get('service-allowances')
  @RequirePermission('masterData:read')
  @ApiPaginated(ServiceAllowanceDto)
  @ApiOperation({ summary: 'Minutes at a stop, by brand and dock type' })
  async serviceAllowances() {
    return plainList(
      await this.reference.serviceAllowances(),
      '/api/v1/service-allowances',
    );
  }

  @Get('traffic-speeds')
  @RequirePermission('masterData:read')
  @ApiPaginated(TrafficSpeedDto)
  @ApiQuery({ name: 'districtId', required: false, type: String })
  @ApiOperation({ summary: 'Hourly speed index by district' })
  async trafficSpeeds(@Query('districtId') districtId?: string) {
    return plainList(
      await this.reference.trafficSpeeds(districtId),
      '/api/v1/traffic-speeds',
    );
  }

  @Get('road-conditions')
  @RequirePermission('masterData:read')
  @ApiPaginated(RoadConditionDto)
  @ApiOperation({ summary: 'Daily road disruption by district' })
  async roadConditions(@Query() range: CalendarRangeQueryDto) {
    return plainList(
      await this.reference.roadConditions(range),
      '/api/v1/road-conditions',
    );
  }
}
