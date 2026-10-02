import { Injectable } from '@nestjs/common';
import type { Actor } from '@waypoint/shared';
import { CrudQueryService } from '../../../core/persistence/crud-query.service';
import type { ListQuery, Page } from '../../../core/persistence/page';
import { ALERT_RESOURCE } from '../alert.resource';
import { AlertScope } from '../policies/alert.scope';
import type { AlertRow } from './alerts.service';

/**
 * Reads of alerts, always through the module's scope (architecture rule 5),
 * so a dispatcher scoped to Kandy neither lists nor opens a Peliyagoda alert
 * (AC-ALR-07, AC-ALR-09).
 */
@Injectable()
export class AlertQueries {
  constructor(
    private readonly crud: CrudQueryService,
    private readonly scope: AlertScope,
  ) {}

  list(query: ListQuery, actor: Actor): Promise<Page<AlertRow>> {
    return this.crud.list<AlertRow>(
      ALERT_RESOURCE,
      query,
      this.scope.where(actor),
    );
  }

  /** One alert, or 404 when it is missing or outside the caller's scope. */
  get(id: string, actor: Actor): Promise<AlertRow> {
    return this.crud.get<AlertRow>(ALERT_RESOURCE, id, this.scope.where(actor));
  }
}
