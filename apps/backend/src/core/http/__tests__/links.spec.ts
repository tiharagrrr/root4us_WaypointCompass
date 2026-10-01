import type { Actor } from '@waypoint/shared';
import type { Request } from 'express';
import type { ClockService } from '../../clock/clock.service';
import { LinkBuilder, type LinkMap, pageLinks } from '../links';

const req = (originalUrl: string) => ({ originalUrl }) as Request;

const actor: Actor = {
  id: 'u1',
  name: 'Test',
  role: 'store_manager',
  depotId: null,
  outletId: 'OUT014',
  vehicleId: null,
  deviceId: null,
};

interface Row {
  id: string;
  status: 'DRAFT' | 'SUBMITTED';
}

class RowLinks extends LinkBuilder<Row> {
  constructor(protected readonly clock: ClockService) {
    super();
  }

  protected self(row: Row) {
    return `/api/v1/orders/${row.id}`;
  }

  protected actions(row: Row, _actor: Actor, now: Date): LinkMap {
    return {
      submit: row.status === 'DRAFT' &&
        now.getUTCHours() < 10 && {
          href: `/api/v1/orders/${row.id}/submit`,
          method: 'POST',
          requires: ['If-Match'],
        },
      cancel: null,
    };
  }
}

describe('links', () => {
  it('pages a table: first, prev, next and last keep the filters', () => {
    const url =
      '/api/v1/orders?filter[status]=SUBMITTED,PLANNED&sort=-submittedAt&limit=10&offset=10';
    expect(pageLinks(req(url), { limit: 10, offset: 10, total: 57 })).toEqual({
      self: { href: url },
      first: {
        href: '/api/v1/orders?filter[status]=SUBMITTED,PLANNED&sort=-submittedAt&limit=10&offset=0',
      },
      prev: {
        href: '/api/v1/orders?filter[status]=SUBMITTED,PLANNED&sort=-submittedAt&limit=10&offset=0',
      },
      next: {
        href: '/api/v1/orders?filter[status]=SUBMITTED,PLANNED&sort=-submittedAt&limit=10&offset=20',
      },
      last: {
        href: '/api/v1/orders?filter[status]=SUBMITTED,PLANNED&sort=-submittedAt&limit=10&offset=50',
      },
    });
  });

  it('gives the first page no prev and the last page no next', () => {
    const links = pageLinks(req('/api/v1/orders'), {
      limit: 10,
      offset: 0,
      total: 7,
    });
    expect(Object.keys(links)).toEqual(['self', 'first', 'last']);
    expect(links.last.href).toBe('/api/v1/orders?limit=10&offset=0');
  });

  it('pages a feed by cursor: next only while there is more', () => {
    const more = pageLinks(req('/api/v1/audit-events?limit=50&cursor=abc'), {
      limit: 50,
      nextCursor: 'def',
      hasMore: true,
    });
    expect(more).toEqual({
      self: { href: '/api/v1/audit-events?limit=50&cursor=abc' },
      first: { href: '/api/v1/audit-events?limit=50' },
      next: { href: '/api/v1/audit-events?limit=50&cursor=def' },
    });
    const done = pageLinks(req('/api/v1/audit-events?cursor=def'), {
      limit: 50,
      nextCursor: null,
      hasMore: false,
    });
    expect(done.next).toBeUndefined();
  });

  it('shows an action link only while it is allowed, at the clock time', () => {
    let now = new Date('2026-10-01T09:59:00Z');
    const links = new RowLinks({ now: () => now } as ClockService);
    expect(links.one({ id: 'o1', status: 'DRAFT' }, actor)._links).toEqual({
      self: { href: '/api/v1/orders/o1' },
      submit: {
        href: '/api/v1/orders/o1/submit',
        method: 'POST',
        requires: ['If-Match'],
      },
    });
    now = new Date('2026-10-01T10:00:00Z');
    expect(links.one({ id: 'o1', status: 'DRAFT' }, actor)._links).toEqual({
      self: { href: '/api/v1/orders/o1' },
    });
    expect(links.one({ id: 'o2', status: 'SUBMITTED' }, actor)._links).toEqual({
      self: { href: '/api/v1/orders/o2' },
    });
  });
});
