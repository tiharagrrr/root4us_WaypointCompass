import type { NotificationChannel } from '@waypoint/shared';
import { codeLabel, dayLabel, timeLabel } from './format';

/**
 * The catalog in specs/notifications/spec.md: for each event, who hears about
 * it, on which channels, and what it says. Pure, so every line of copy is
 * tested without a database; the dispatcher looks up the recipients and the
 * facts (order numbers, vehicle codes, outlet names) the payloads only carry
 * ids for.
 */

/** Who an entry reaches, resolved by role and scope (never a user outside the event's scope). */
export type Audience =
  /** Store managers of the event's outlets. */
  | 'storeManagers'
  /** Dispatchers of the event's depot, and those with no depot (every depot). */
  | 'dispatchers'
  /** Loaders of the event's depot. */
  | 'loaders'
  /** The driver of each trip the event names (tripIds, tripId or a trip aggregate). */
  | 'tripDrivers'
  /** The driver named on the payload (driverId). */
  | 'driver'
  /** The loader who raised the flag the event decides. */
  | 'flagRaiser';

/** What the dispatcher looked up for one recipient. */
export interface Facts {
  orderNo?: string | null;
  outletName?: string | null;
  vehicleCode?: string | null;
  tripNo?: number | null;
  stops?: number | null;
  firstOutletName?: string | null;
  firstArrivalAt?: string | null;
}

export interface Message {
  title: string;
  body: string;
  /** The web route the notification opens. */
  link: string;
}

/** Settings a rule reads, looked up for the event's depot. */
export interface RuleContext {
  /** tracking.etaSlipNotifyMinutes: the smallest ETA slip worth telling a store about. */
  etaSlipMinutes: number;
}

export interface CatalogEntry {
  to: Audience;
  channels: readonly NotificationChannel[];
  /** null: this event says nothing to this audience (a flag with no raiser, say). */
  message(payload: Payload, facts: Facts): Message | null;
  /** Quiet rule: false drops the event for this audience (a small ETA slip, AC-NTF-10). */
  when?(payload: Payload, context: RuleContext): boolean;
  /**
   * Bursts collapse: within `minutes` of a notification with the same key,
   * the same person gets nothing new (ten ETA updates, one notice).
   */
  collapse?: { key(payload: Payload): string | null; minutes: number };
}

export type Payload = Record<string, unknown>;

const str = (value: unknown) => (typeof value === 'string' ? value : null);
const order = (f: Facts) => (f.orderNo ? `Order ${f.orderNo}` : 'Your order');
const vehicle = (f: Facts) => f.vehicleCode ?? 'Your vehicle';

const STORE_ORDER = (p: Payload) =>
  str(p.orderId) ? `/store/orders/${str(p.orderId)}` : '/store/orders';
const DISPATCH_TRIP = (p: Payload) =>
  str(p.tripId) ? `/dispatch/trips/${str(p.tripId)}` : '/dispatch/tracking';

/** "REF-07, Run 1, 6 stops" with whatever is known. */
function tripLine(f: Facts): string {
  const parts = [vehicle(f)];
  if (f.tripNo) parts.push(`Run ${f.tripNo}`);
  if (f.stops != null) parts.push(`${f.stops} stop${f.stops === 1 ? '' : 's'}`);
  return parts.join(', ');
}

export const CATALOG: Readonly<Record<string, readonly CatalogEntry[]>> = {
  'order.submitted': [
    {
      to: 'storeManagers',
      channels: ['IN_APP', 'EMAIL'],
      message: (p, f) => ({
        title: `${order(f)} sent`,
        body: `${order(f)} sent for ${dayLabel(p.deliveryDate) ?? 'the next run'}.`,
        link: STORE_ORDER(p),
      }),
    },
  ],
  'order.rolled_to_next_run': [
    {
      to: 'storeManagers',
      channels: ['IN_APP', 'EMAIL', 'PUSH'],
      message: (p, f) => {
        const day = dayLabel(p.deliveryDate) ?? 'the next run';
        return {
          title: `${order(f)} moved to ${day}`,
          body:
            p.reason === 'WEEKLY_DELIVERY_DAY'
              ? `Your weekly delivery day is ${day}, so it goes on that run.`
              : `Sent after the cutoff, so it goes on ${day}'s run.`,
          link: STORE_ORDER(p),
        };
      },
    },
  ],
  'plan.published': [
    {
      to: 'loaders',
      channels: ['PUSH', 'IN_APP'],
      message: (p) => {
        const trips = Array.isArray(p.tripIds) ? p.tripIds.length : null;
        return {
          title: 'Plan ready to load',
          body: `The plan for ${dayLabel(p.date) ?? 'tomorrow'} is ready${trips == null ? '' : `: ${trips} trip${trips === 1 ? '' : 's'}`}.`,
          link: '/dock',
        };
      },
    },
    {
      to: 'tripDrivers',
      channels: ['PUSH', 'SMS', 'IN_APP'],
      message: (_p, f) => ({
        title: `Your trip: ${vehicle(f)}`,
        body: `Your trip: ${tripLine(f)}.`,
        link: '/driver',
      }),
    },
    {
      to: 'storeManagers',
      channels: ['IN_APP', 'EMAIL'],
      message: (p) => ({
        title: 'Delivery planned',
        body: `Delivery planned for ${dayLabel(p.date) ?? 'your next run'}.`,
        link: '/store/orders',
      }),
    },
  ],
  // Only the trips the revision touched, and the stores on them (AC-NTF-11).
  'plan.revised': [
    {
      to: 'tripDrivers',
      channels: ['PUSH', 'IN_APP'],
      message: (_p, f) => ({
        title: 'Plan updated',
        body: `Plan updated: your trip on ${vehicle(f)} changed. Open the app for the new stops.`,
        link: '/driver',
      }),
    },
    {
      to: 'storeManagers',
      channels: ['PUSH', 'IN_APP'],
      message: (p) => ({
        title: 'Plan updated',
        body: `Plan updated: your delivery for ${dayLabel(p.date) ?? 'the next run'} changed.`,
        link: '/store/orders',
      }),
    },
  ],
  'deferral.confirmed': [
    {
      to: 'storeManagers',
      channels: ['PUSH', 'EMAIL', 'IN_APP'],
      message: (p, f) => {
        const day = dayLabel(p.toDate) ?? 'a later run';
        const why = codeLabel(p.reasonCode);
        return {
          title: `${order(f)} moves to ${day}`,
          body: `${order(f)} moves to ${day}${why ? `: ${why}` : ''}.`,
          link: str(p.deferralId)
            ? `/store/deferrals/${str(p.deferralId)}`
            : '/store/deferrals',
        };
      },
    },
  ],
  'deferral.store_responded': [
    {
      to: 'dispatchers',
      channels: ['PUSH', 'IN_APP'],
      message: (p, f) => {
        const outlet = f.outletName ?? 'A store';
        return p.priorityRequested
          ? {
              title: `${outlet} asks for priority`,
              body: `${outlet} asks for priority on ${f.orderNo ?? 'its deferred order'}${str(p.note) ? `: "${str(p.note)}"` : '.'}`,
              link: '/dispatch/deferrals',
            }
          : {
              title: `${outlet} acknowledged a deferral`,
              body: `${outlet} acknowledged the deferral of ${f.orderNo ?? 'its order'}.`,
              link: '/dispatch/deferrals',
            };
      },
    },
  ],
  'load.flag_raised': [
    {
      to: 'dispatchers',
      channels: ['PUSH', 'IN_APP'],
      message: (p, f) => {
        const qty = typeof p.qtyAffected === 'number' ? p.qtyAffected : null;
        const what = `${qty == null ? 'cases' : `${qty} case${qty === 1 ? '' : 's'}`} ${codeLabel(p.reason) ?? 'flagged'}`;
        return {
          title: `${vehicle(f)}: ${what}`,
          body: `${vehicle(f)}: ${what}${f.outletName ? `, ${f.outletName}` : ''}.`,
          link: DISPATCH_TRIP(p),
        };
      },
    },
  ],
  'load.flag_decided': [
    {
      to: 'flagRaiser',
      channels: ['IN_APP'],
      message: (p, f) => ({
        title: 'Flag decided',
        body: `Dispatcher: ${codeLabel(p.decision) ?? 'decided'}${f.orderNo ? ` for ${f.orderNo}` : ''}.`,
        link: '/dock',
      }),
    },
  ],
  'trip.released': [
    {
      to: 'tripDrivers',
      channels: ['PUSH', 'SMS'],
      message: (_p, f) => {
        const first =
          f.firstOutletName && timeLabel(f.firstArrivalAt)
            ? `, first ${f.firstOutletName} at ${timeLabel(f.firstArrivalAt)}`
            : '';
        return {
          title: `${vehicle(f)} released`,
          body: `${vehicle(f)}${f.tripNo ? ` trip ${f.tripNo}` : ''} released. ${f.stops ?? 'Your'} stop${f.stops === 1 ? '' : 's'}${first}. Open the app to start.`,
          link: '/driver',
        };
      },
    },
  ],
  'stop.completed': [
    {
      to: 'storeManagers',
      channels: ['PUSH', 'IN_APP', 'EMAIL'],
      message: (p, f) => {
        const at = timeLabel(p.completedAt ?? p.occurredAt);
        return {
          title: at ? `Delivered ${at}` : 'Delivered',
          body: `${order(f)} delivered${at ? ` at ${at}` : ''}.`,
          link: STORE_ORDER(p),
        };
      },
    },
  ],
  // A store hears about a slip only past the threshold, and once per burst (AC-NTF-10).
  'eta.updated': [
    {
      to: 'storeManagers',
      channels: ['PUSH', 'IN_APP'],
      when: (p, ctx) =>
        typeof p.slipMin === 'number' && p.slipMin >= ctx.etaSlipMinutes,
      collapse: {
        key: (p) => (str(p.stopId) ? `eta:${str(p.stopId)}` : null),
        minutes: 10,
      },
      message: (p, f) => {
        const at = timeLabel(p.etaAt);
        return {
          title: at ? `Now arriving around ${at}` : 'Delivery running late',
          body: at
            ? `Now arriving around ${at}.`
            : `${order(f)} is running late.`,
          link: STORE_ORDER(p),
        };
      },
    },
  ],
  'trip.cant_run': [
    {
      to: 'dispatchers',
      channels: ['PUSH', 'IN_APP'],
      message: (p, f) => ({
        title: `${vehicle(f)} can't run`,
        body: `${vehicle(f)} can't run${codeLabel(p.reason) ? `: ${codeLabel(p.reason)}` : ''}.`,
        link: DISPATCH_TRIP(p),
      }),
    },
  ],
  'trip.reassigned': [
    {
      to: 'driver',
      channels: ['PUSH', 'SMS', 'IN_APP'],
      message: (_p, f) => ({
        title: `Your trip moved to ${vehicle(f)}`,
        body: `Your trip moved to ${tripLine(f)}.`,
        link: '/driver',
      }),
    },
    {
      to: 'storeManagers',
      channels: ['IN_APP'],
      message: (p, f) =>
        p.vehicleChanged
          ? {
              title: 'Delivery vehicle changed',
              body: `Your delivery is now on ${vehicle(f)}.`,
              link: '/store/orders',
            }
          : null,
    },
  ],
};

/** How the preference screens (D12, 02's Settings) name each event. */
export const EVENT_LABELS: Record<string, string> = {
  'order.submitted': 'Order sent',
  'order.rolled_to_next_run': 'Order moved to the next run',
  'plan.published': 'Plan published',
  'plan.revised': 'Plan updated',
  'deferral.confirmed': 'Order deferred',
  'deferral.store_responded': 'Store answered a deferral',
  'load.flag_raised': 'Loading flag raised',
  'load.flag_decided': 'Loading flag decided',
  'trip.released': 'Trip released',
  'stop.completed': 'Delivered',
  'eta.updated': 'Running late',
  'trip.cant_run': "Trip can't run",
  'trip.reassigned': 'Trip reassigned',
};

/** The audiences an event reaches, by role: what the preference screens list. */
export const ROLE_OF: Record<Audience, string> = {
  storeManagers: 'store_manager',
  dispatchers: 'dispatcher',
  loaders: 'loader',
  tripDrivers: 'driver',
  driver: 'driver',
  flagRaiser: 'loader',
};

export const consumes = (type: string): boolean => type in CATALOG;
