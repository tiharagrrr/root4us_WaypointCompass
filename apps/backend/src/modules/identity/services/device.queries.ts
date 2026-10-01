import { Injectable } from '@nestjs/common';
import type { Actor } from '@waypoint/shared';
import { ilike, or } from 'drizzle-orm';
import { CrudQueryService } from '../../../core/persistence/crud-query.service';
import type { ListQuery, Page } from '../../../core/persistence/page';
import {
  booleanFilter,
  contains,
  enumFilter,
  type ResourceSpec,
  textFilter,
} from '../../../core/persistence/resource-spec';
import { devices } from '../../../db/schema';
import { DeviceScope } from '../policies/admin.scope';

export type DeviceAdminRow = typeof devices.$inferSelect;

/** Registered devices for A6's dock tablets card. */
export const DEVICES = {
  name: 'devices',
  table: devices,
  queryKey: 'devices',
  pagination: 'offset',
  defaultSort: '-lastSeenAt',
  filters: {
    isDockDevice: booleanFilter(devices.isDockDevice),
    depotId: textFilter(devices.depotId),
    platform: enumFilter(devices.platform),
  },
  sorts: { lastSeenAt: devices.lastSeenAt, createdAt: devices.createdAt },
  search: (q) =>
    or(ilike(devices.id, contains(q)), ilike(devices.label, contains(q))),
} satisfies ResourceSpec<typeof devices>;

@Injectable()
export class DeviceQueries {
  constructor(
    private readonly crud: CrudQueryService,
    private readonly scope: DeviceScope,
  ) {}

  list(query: ListQuery, actor: Actor): Promise<Page<DeviceAdminRow>> {
    return this.crud.list<DeviceAdminRow>(
      DEVICES,
      query,
      this.scope.where(actor),
    );
  }

  /** One device, or 404 when it never registered. */
  get(id: string, actor: Actor): Promise<DeviceAdminRow> {
    return this.crud.get<DeviceAdminRow>(DEVICES, id, this.scope.where(actor));
  }
}
