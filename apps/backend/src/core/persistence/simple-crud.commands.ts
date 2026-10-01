import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { and, eq, getTableColumns, sql } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import { NotFoundError, VersionMismatchError } from '../errors/domain-errors';
import type {
  AuditRecorder,
  EventPayload,
  EventRouting,
  OutboxWriter,
} from './ports';
import type { StampedDrizzleAdapter } from './transactions';

type Row<T extends PgTable> = T['$inferSelect'] & { id: string };

/**
 * Create and update for master data with no lifecycle (outlets, depots,
 * items, vehicles, reasons): write, audit row and outbox event in one
 * transaction, with optimistic concurrency when the table has `version`.
 * Resources with a lifecycle (orders, plans, trips, stops, deferrals) never
 * use this: each of their writes is its own use case with a state check.
 *
 *   @Injectable()
 *   export class VehicleCommands extends SimpleCrudCommands<typeof vehicles, CreateVehicleDto, UpdateVehicleDto> {
 *     protected readonly table = vehicles;
 *     protected readonly module = 'fleet';
 *     protected readonly entityType = 'vehicle';
 *     constructor(txHost: TransactionHost<StampedDrizzleAdapter>, audit: AuditService, outbox: OutboxService) {
 *       super(txHost, audit, outbox);
 *     }
 *     protected toValues(dto: CreateVehicleDto) { ... }
 *     protected toChanges(dto: UpdateVehicleDto) { ... }
 *   }
 */
export abstract class SimpleCrudCommands<
  TTable extends PgTable,
  TCreate,
  TUpdate,
> {
  protected abstract readonly table: TTable;
  /** The module, for audit actions: 'fleet' gives 'fleet.vehicle.created'. */
  protected abstract readonly module: string;
  /** The entity, for events and 404s: 'vehicle' gives 'vehicle.created'. */
  protected abstract readonly entityType: string;
  protected abstract toValues(dto: TCreate): TTable['$inferInsert'];
  protected abstract toChanges(dto: TUpdate): Partial<TTable['$inferInsert']>;

  /** The audited fields; override to leave out anything bulky or private. */
  protected toAudit(row: Row<TTable>): unknown {
    return row;
  }

  /** Channels for the event; define it to route by depot or outlet. */
  protected routing?(row: Row<TTable>): Omit<EventRouting, 'aggregate'>;

  constructor(
    protected readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    protected readonly audit: AuditRecorder,
    protected readonly outbox: OutboxWriter,
  ) {}

  @Transactional()
  async create(dto: TCreate): Promise<Row<TTable>> {
    const [row] = (await this.txHost.tx
      .insert(this.table)
      .values(this.toValues(dto))
      .returning()) as unknown as Row<TTable>[];
    await this.recordAndEmit('created', row);
    return row;
  }

  /**
   * Updates the row; with `version` (from If-Match) the update applies only
   * if nobody changed it since, and bumps the version. 404 if it's missing,
   * 412 VERSION_MISMATCH if the version is stale.
   */
  @Transactional()
  async update(
    id: string,
    dto: TUpdate,
    version?: number,
  ): Promise<Row<TTable>> {
    const { id: idCol, version: versionCol } = this.columns();
    const tx = this.txHost.tx;
    const table: PgTable = this.table;
    const [before] = (await tx
      .select()
      .from(table)
      .where(eq(idCol, id))) as unknown as Row<TTable>[];
    if (!before) throw new NotFoundError(this.entityType);

    const [row] = (await tx
      .update(this.table)
      .set({
        ...this.toChanges(dto),
        ...(versionCol && { version: sql`${versionCol} + 1` }),
      })
      .where(
        and(
          eq(idCol, id),
          version != null && versionCol ? eq(versionCol, version) : undefined,
        ),
      )
      .returning()) as unknown as Row<TTable>[];
    if (!row) throw new VersionMismatchError(this.entityType);
    await this.recordAndEmit('updated', row, before);
    return row;
  }

  private async recordAndEmit(
    verb: 'created' | 'updated',
    row: Row<TTable>,
    before?: Row<TTable>,
  ): Promise<void> {
    const entity: [string, string] = [this.entityType, String(row.id)];
    await this.audit.record({
      action: `${this.module}.${this.entityType}.${verb}`,
      entity,
      before: before && this.toAudit(before),
      after: this.toAudit(row),
    });
    const payload: EventPayload = { v: 1, id: row.id };
    await this.outbox.add(`${this.entityType}.${verb}`, payload, {
      aggregate: entity,
      ...this.routing?.(row),
    });
  }

  private columns(): { id: AnyPgColumn; version?: AnyPgColumn } {
    const columns = getTableColumns(this.table) as Record<
      string,
      AnyPgColumn | undefined
    >;
    if (!columns.id) throw new Error(`${this.entityType}: the table has no id`);
    return { id: columns.id, version: columns.version };
  }
}
