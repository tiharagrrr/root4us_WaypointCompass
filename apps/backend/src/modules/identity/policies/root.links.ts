import { Injectable } from '@nestjs/common';
import { DEPOTS, type Links, type UserRole } from '@waypoint/shared';
import { ClockService } from '../../../core/clock/clock.service';
import type { Actor } from '../../../core/http/decorators';

const API = '/api/v1';
/** The header's depot switch starts at Peliyagoda for a dispatcher of all depots. */
const DEFAULT_DEPOT = DEPOTS[0];
const PAGED = '{?filter,sort,q,limit,offset}';

interface Day {
  depot: string | null;
  today: string;
  tomorrow: string;
}

/** Where each role's shell starts: the web app picks its landing route from these. */
const LANDING: Record<UserRole, (day: Day) => Links> = {
  admin: () => ({
    users: {
      href: `${API}/users{?filter,q,limit,offset}`,
      templated: true,
      title: 'Users',
    },
    settings: { href: `${API}/settings`, title: 'Settings' },
  }),
  dispatcher: ({ depot, today, tomorrow }) => {
    const d = depot ?? DEFAULT_DEPOT;
    return {
      today: { href: `${API}/depots/${d}/days/${today}`, title: 'Today' },
      tomorrowPlan: {
        href: `${API}/depots/${d}/plans/${tomorrow}`,
        title: "Tomorrow's plan",
      },
      orders: {
        href: `${API}/orders${PAGED}`,
        templated: true,
        title: 'Orders',
      },
      alerts: { href: `${API}/alerts?filter[status]=OPEN`, title: 'Alerts' },
      tracking: { href: `${API}/depots/${d}/tracking`, title: 'Tracking' },
    };
  },
  store_manager: ({ today }) => ({
    myOrders: {
      href: `${API}/orders${PAGED}`,
      templated: true,
      title: 'My orders',
    },
    deliveries: {
      href: `${API}/orders?filter[deliveryDate]=${today}`,
      title: "Today's deliveries",
    },
  }),
  loader: ({ depot, today }): Links =>
    depot
      ? {
          loadingBoard: {
            href: `${API}/depots/${depot}/loading/runs?date=${today}`,
            title: 'Loading board',
          },
        }
      : {},
  driver: ({ today }) => ({
    myTrips: { href: `${API}/me/trips?date=${today}`, title: 'My trips' },
  }),
};

/** GET /: who the caller is and where their role starts (specs/identity/spec.md). */
@Injectable()
export class RootLinks {
  constructor(private readonly clock: ClockService) {}

  root(actor: Actor) {
    const now = this.clock.now();
    const day: Day = {
      depot: actor.depotId,
      today: this.clock.businessDate(now),
      tomorrow: this.clock.businessDate(now, 1),
    };
    return {
      name: 'Waypoint Compass API',
      actor: {
        id: actor.id,
        name: actor.name,
        role: actor.role,
        depotId: actor.depotId,
      },
      _links: {
        self: { href: API },
        me: { href: `${API}/me` },
        ...LANDING[actor.role](day),
        events: { href: `${API}/streams/me` },
        docs: { href: '/api/docs' },
      } satisfies Links,
    };
  }
}
