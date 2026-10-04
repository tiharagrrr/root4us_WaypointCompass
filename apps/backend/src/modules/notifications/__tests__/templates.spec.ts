import { CATALOG } from '../domain/catalog';
import { FIXTURES } from '../domain/fixtures';
import { preview } from '../domain/preview';
import {
  isGsm7,
  PUSH_BODY_MAX,
  PUSH_TITLE_MAX,
  render,
  SMS_MAX,
} from '../domain/render';

/** Every catalog message with its fixture, before any clamping. */
const messages = Object.entries(CATALOG).flatMap(([eventType, entries]) =>
  entries.flatMap((entry) => {
    const fixture = FIXTURES[eventType];
    const message = fixture && entry.message(fixture.payload, fixture.facts);
    return message ? [{ eventType, to: entry.to, message, fixture }] : [];
  }),
);

describe('notification templates', () => {
  it('has a fixture for every catalog event', () => {
    expect(Object.keys(FIXTURES).sort()).toEqual(Object.keys(CATALOG).sort());
  });

  it('AC-NTF-14 Templates fit their channel', () => {
    const sms = preview('trip.released', 'SMS', 'en');
    expect(sms?.audiences[0].rendered).toEqual({
      channel: 'SMS',
      text: 'Waypoint: REF-07 trip 1 released. 6 stops, first Fresh Kadawatha at 04:10. Open the app to start.',
    });

    for (const { eventType, to, message, fixture } of messages) {
      const where = `${eventType} to ${to}`;
      const text = `Waypoint: ${message.body}`;
      expect({ where, ok: text.length <= SMS_MAX }).toEqual({
        where,
        ok: true,
      });
      expect({ where, ok: isGsm7(text) }).toEqual({ where, ok: true });
      expect({ where, ok: message.title.length <= PUSH_TITLE_MAX }).toEqual({
        where,
        ok: true,
      });
      expect({ where, ok: message.body.length <= PUSH_BODY_MAX }).toEqual({
        where,
        ok: true,
      });
      const push = render('PUSH', message, {
        eventType,
        entityId: fixture.entityId,
      });
      expect(push).toMatchObject({
        link: expect.stringMatching(/^\//) as string,
        tag: `${eventType}:${fixture.entityId}`,
      });
    }
  });

  it('falls back to English for a locale with no copy yet', () => {
    expect(preview('trip.released', 'PUSH', 'si')).toMatchObject({
      requestedLocale: 'si',
      locale: 'en',
    });
    expect(preview('nope.never', 'SMS')).toBeNull();
  });

  it('clamps what would overflow, and keeps SMS in GSM-7', () => {
    const long = {
      title: 'x'.repeat(60),
      body: `${'y'.repeat(200)} “quoted” — done`,
      link: '/x',
    };
    const sms = render('SMS', long, { eventType: 'e', entityId: '1' });
    expect(sms.channel === 'SMS' && sms.text.length).toBe(SMS_MAX);
    expect(sms.channel === 'SMS' && isGsm7(sms.text)).toBe(true);
    const push = render('PUSH', long, { eventType: 'e', entityId: '1' });
    expect(push.channel === 'PUSH' && push.title.length).toBe(PUSH_TITLE_MAX);
  });
});
