import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { NotificationChannel } from '@waypoint/shared';
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import type { DeliveredEvent } from '../../../core/outbox/event-bus';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import {
  devices,
  loadFlags,
  notificationPreferences,
  orders,
  outlets,
  stops,
  trips,
  users,
  vehicles,
} from '../../../db/schema';
import type { Audience, Facts, Payload } from '../domain/catalog';
import type { Reachability } from '../domain/channels';
import { ALL_EVENTS } from '../notifications.constants';

/** One person an event reaches, with where to reach them and what it is about for them. */
export interface Recipient extends Reachability {
  userId: string;
  /** Their own trip, for a driver: the message names their vehicle. */
  tripId?: string;
  /** Their preference row for this event type, or null for the defaults. */
  preference: NotificationChannel[] | null;
}

const strings = (...values: unknown[]): string[] =>
  values
    .flatMap((v): unknown[] => (Array.isArray(v) ? (v as unknown[]) : [v]))
    .filter((v): v is string => typeof v === 'string' && v.length > 0);

/**
 * Who an event reaches and what the messages need to say, read inside the
 * relay's transaction. Recipients come from the event's routing (depot,
 * outlets, trips), the same scope the stream uses, so a user outside it never
 * gets a row. Notifications reads these tables and writes none of them.
 */
@Injectable()
export class RecipientsService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
  ) {}

  async resolve(
    audience: Audience,
    event: DeliveredEvent,
  ): Promise<Recipient[]> {
    const payload = (event.payload ?? {}) as Payload;
    const people = await this.people(audience, event, payload);
    if (!people.length) return [];
    const ids = [...new Set(people.map((p) => p.userId))];

    const tx = this.txHost.tx;
    const rows = await tx
      .select({
        id: users.id,
        email: users.email,
        phone: users.phoneNumber,
        phoneVerified: users.phoneNumberVerified,
      })
      .from(users)
      .where(
        and(
          inArray(users.id, ids),
          or(isNull(users.banned), eq(users.banned, false)),
        ),
      );
    const pushers = await tx
      .selectDistinct({ userId: devices.userId })
      .from(devices)
      .where(
        and(inArray(devices.userId, ids), isNotNull(devices.pushEndpoint)),
      );
    const prefs = await tx
      .select()
      .from(notificationPreferences)
      .where(
        and(
          inArray(notificationPreferences.userId, ids),
          inArray(notificationPreferences.eventType, [event.type, ALL_EVENTS]),
        ),
      );

    const byId = new Map(rows.map((r) => [r.id, r]));
    const push = new Set(pushers.map((p) => p.userId));
    // The event's own row and the all-events row (an email switched off after a bounce) both apply.
    const pref = new Map<string, NotificationChannel[]>();
    for (const p of prefs) {
      const had = pref.get(p.userId);
      pref.set(
        p.userId,
        had ? had.filter((c) => p.channels.includes(c)) : p.channels,
      );
    }
    return people.flatMap((p) => {
      const user = byId.get(p.userId);
      if (!user) return [];
      return [
        {
          userId: user.id,
          tripId: p.tripId,
          email: user.email,
          phone: user.phoneVerified ? user.phone : null,
          push: push.has(user.id),
          preference: pref.get(user.id) ?? null,
        },
      ];
    });
  }

  /** The facts one recipient's message needs; every lookup is by id. */
  async facts(payload: Payload, recipient: Recipient): Promise<Facts> {
    const tx = this.txHost.tx;
    const facts: Facts = {};
    const [orderId] = strings(payload.orderId);
    if (orderId) {
      const [row] = await tx
        .select({ orderNo: orders.orderNo, outletName: outlets.name })
        .from(orders)
        .innerJoin(outlets, eq(outlets.id, orders.outletId))
        .where(eq(orders.id, orderId));
      Object.assign(facts, row);
    }
    const [outletId] = strings(payload.outletId);
    if (outletId && !facts.outletName) {
      const [row] = await tx
        .select({ outletName: outlets.name })
        .from(outlets)
        .where(eq(outlets.id, outletId));
      Object.assign(facts, row);
    }
    const [tripId] = strings(recipient.tripId, payload.tripId);
    if (tripId) {
      const [trip] = await tx
        .select({ vehicleCode: vehicles.code, tripNo: trips.tripNo })
        .from(trips)
        .innerJoin(vehicles, eq(vehicles.id, trips.vehicleId))
        .where(eq(trips.id, tripId));
      const live = and(eq(stops.tripId, tripId), ne(stops.status, 'CANCELLED'));
      const [count] = await tx
        .select({ n: sql<number>`count(*)`.mapWith(Number) })
        .from(stops)
        .where(live);
      const [first] = await tx
        .select({
          firstOutletName: outlets.name,
          firstArrivalAt: stops.plannedArrivalAt,
        })
        .from(stops)
        .innerJoin(outlets, eq(outlets.id, stops.outletId))
        .where(live)
        .orderBy(asc(stops.seq))
        .limit(1);
      Object.assign(facts, trip, {
        stops: count?.n ?? null,
        firstOutletName: first?.firstOutletName ?? null,
        firstArrivalAt: first?.firstArrivalAt?.toISOString() ?? null,
      });
    }
    return facts;
  }

  private async people(
    audience: Audience,
    event: DeliveredEvent,
    payload: Payload,
  ): Promise<{ userId: string; tripId?: string }[]> {
    const tx = this.txHost.tx;
    const ofRole = async (role: string, where: ReturnType<typeof and>) =>
      (
        await tx
          .select({ userId: users.id })
          .from(users)
          .where(and(eq(users.role, role), where))
      ).map((u) => ({ userId: u.userId }));

    switch (audience) {
      case 'storeManagers': {
        const outletIds = strings(event.outletIds, payload.outletId);
        return outletIds.length
          ? ofRole('store_manager', inArray(users.outletId, outletIds))
          : [];
      }
      case 'dispatchers':
        return event.depotId
          ? ofRole(
              'dispatcher',
              or(eq(users.depotId, event.depotId), isNull(users.depotId)),
            )
          : [];
      case 'loaders':
        return event.depotId
          ? ofRole('loader', eq(users.depotId, event.depotId))
          : [];
      case 'tripDrivers': {
        const tripIds = strings(
          payload.tripIds,
          payload.tripId,
          event.aggregateType === 'trip' ? event.aggregateId : null,
        );
        if (!tripIds.length) return [];
        const rows = await tx
          .select({ userId: trips.driverId, tripId: trips.id })
          .from(trips)
          .where(and(inArray(trips.id, tripIds), isNotNull(trips.driverId)));
        return rows.flatMap((r) =>
          r.userId ? [{ userId: r.userId, tripId: r.tripId }] : [],
        );
      }
      case 'driver': {
        const [driverId] = strings(payload.driverId);
        const [tripId] = strings(payload.tripId);
        return driverId ? [{ userId: driverId, tripId }] : [];
      }
      case 'flagRaiser': {
        const [flagId] = strings(payload.flagId);
        if (!flagId) return [];
        const [flag] = await tx
          .select({ userId: loadFlags.raisedByUserId })
          .from(loadFlags)
          .where(eq(loadFlags.id, flagId));
        return flag?.userId ? [{ userId: flag.userId }] : [];
      }
    }
  }
}
