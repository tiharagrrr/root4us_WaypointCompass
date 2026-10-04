import { ProviderError, type SmsProvider } from '../ports';

/** A gateway that answers once with `body`, recording what it was sent. */
export function gateway(body: unknown, init: ResponseInit = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const http = jest.fn((url: string | URL, req?: RequestInit) => {
    calls.push({ url: url.toString(), init: req ?? {} });
    return Promise.resolve(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
        ...init,
      }),
    );
  }) as unknown as typeof fetch;
  return { http, calls };
}

/** A gateway that never answers, or whose connection is refused. */
export function unreachable(error: Error) {
  return jest.fn(() => Promise.reject(error)) as unknown as typeof fetch;
}

export const timeout = (): Error =>
  Object.assign(new Error('timed out'), { name: 'TimeoutError' });

export const formOf = (init: RequestInit): URLSearchParams =>
  new URLSearchParams(init.body as string);

export const jsonOf = (init: RequestInit): Record<string, unknown> =>
  JSON.parse(init.body as string) as Record<string, unknown>;

export const MESSAGE = {
  to: '+94776041932',
  text: 'Your Waypoint Compass sign-in code is 482913.',
  idempotencyKey: '0192a3f4-0000-7000-8000-000000000001',
};

/**
 * What every SmsProvider owes the sender, whichever vendor is behind it: a
 * SendResult with its own name, a ProviderError whose `retryable` flag tells
 * the notify job whether to back off, and a health() that sends nothing.
 *
 * `build` makes the configured adapter over a given fetch, `keyless` the same
 * adapter with nothing configured, and `accepted` is a body that vendor
 * answers a successful send with.
 */
export function describeSmsProvider({
  name,
  build,
  keyless,
  accepted,
}: {
  name: string;
  build: (http: typeof fetch) => SmsProvider;
  keyless: (http: typeof fetch) => SmsProvider;
  accepted: unknown;
}): void {
  describe(`${name} (SmsProvider contract)`, () => {
    it('answers with its own name and the message id', async () => {
      const { http } = gateway(accepted);
      const result = await build(http).send(MESSAGE);
      expect(result.provider).toBe(name);
      expect(result.providerMessageId).toBeTruthy();
    });

    it('is retryable on a timeout: the gateway may be back in 30 s', async () => {
      await expect(
        build(unreachable(timeout())).send(MESSAGE),
      ).rejects.toMatchObject({
        name: 'ProviderError',
        retryable: true,
      });
    });

    it('is retryable on 429 and 503', async () => {
      for (const status of [429, 503]) {
        const { http } = gateway({ message: 'slow down' }, { status });
        await expect(build(http).send(MESSAGE)).rejects.toMatchObject({
          retryable: true,
          providerCode: String(status),
        });
      }
    });

    it('is not retryable on 401: a wrong key stays wrong', async () => {
      const { http } = gateway({ message: 'unauthorised' }, { status: 401 });
      await expect(build(http).send(MESSAGE)).rejects.toMatchObject({
        retryable: false,
      });
    });

    it('refuses a number no gateway can reach, without retrying', async () => {
      const { http, calls } = gateway(accepted);
      await expect(
        build(http).send({ ...MESSAGE, to: '12345' }),
      ).rejects.toMatchObject({ retryable: false });
      expect(calls).toHaveLength(0);
    });

    it('keeps the number out of the refusal it raises', async () => {
      const { http } = gateway(accepted);
      const error: unknown = await build(http)
        .send({ ...MESSAGE, to: '12345' })
        .then(() => null)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ProviderError);
      expect((error as ProviderError).message).not.toContain('12345');
    });

    it('answers health() without sending anything', async () => {
      const { http, calls } = gateway(accepted);
      await expect(build(http).health()).resolves.toBe(true);
      expect(calls).toHaveLength(0);
    });

    it('fails at once when its keys are missing, and reports itself unhealthy', async () => {
      const { http, calls } = gateway(accepted);
      const unconfigured = keyless(http);
      await expect(unconfigured.send(MESSAGE)).rejects.toMatchObject({
        retryable: false,
      });
      await expect(unconfigured.health()).resolves.toBe(false);
      expect(calls).toHaveLength(0);
    });
  });
}
