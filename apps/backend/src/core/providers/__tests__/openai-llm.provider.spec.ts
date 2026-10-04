import { OpenAiCompatibleLlmProvider } from '../openai-llm.provider';
import { ProviderError } from '../ports';

/**
 * The openai-compatible adapter against a mocked server: it never reaches the
 * internet. What matters is the part of the chat completions API every server
 * implements, and that each failure becomes a ProviderError with the right
 * retryable flag.
 */
const OPTIONS = {
  baseUrl: 'https://api.example.test/v1',
  apiKey: 'sk-test',
  model: 'gpt-4o',
};

const REQUEST = { system: 'You direct a day.', prompt: '{"trips":[]}' };

const TOOLS = [
  {
    name: 'inject_road_delay',
    description: 'Slow a district down.',
    inputSchema: {
      type: 'object',
      properties: { minutes: { type: 'number' } },
    },
  },
];

/** A server that answers once with `body`, recording what it was sent. */
function server(body: unknown, init: ResponseInit = {}) {
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

const textReply = {
  choices: [{ finish_reason: 'stop', message: { content: 'Two stops late.' } }],
};

const bodyOf = (init: RequestInit): Record<string, unknown> =>
  JSON.parse(init.body as string) as Record<string, unknown>;

describe('OpenAiCompatibleLlmProvider', () => {
  it('posts to <base>/chat/completions with the system and user messages', async () => {
    const { http, calls } = server(textReply);
    const reply = await new OpenAiCompatibleLlmProvider(OPTIONS, http).complete(
      REQUEST,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.example.test/v1/chat/completions');
    expect(bodyOf(calls[0].init)).toMatchObject({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: REQUEST.system },
        { role: 'user', content: REQUEST.prompt },
      ],
    });
    expect(reply).toEqual({
      provider: 'openai-compatible',
      text: 'Two stops late.',
      toolCalls: [],
    });
  });

  it('sends max_tokens and no field a third-party server would reject', async () => {
    const { http, calls } = server(textReply);
    await new OpenAiCompatibleLlmProvider(OPTIONS, http).complete({
      ...REQUEST,
      tools: TOOLS,
    });

    const body = bodyOf(calls[0].init);
    expect(body.max_tokens).toBe(4096);
    expect(body).not.toHaveProperty('max_completion_tokens');
    expect(body).not.toHaveProperty('parallel_tool_calls');
    expect(body.tool_choice).toBe('auto');
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'inject_road_delay',
          description: 'Slow a district down.',
          parameters: TOOLS[0].inputSchema,
        },
      },
    ]);
    // `strict` is OpenAI-only: a gateway or a local server rejects it.
    const [tool] = body.tools as { function: Record<string, unknown> }[];
    expect(tool.function).not.toHaveProperty('strict');
  });

  it('trims a trailing slash off the base URL', async () => {
    const { http, calls } = server(textReply);
    await new OpenAiCompatibleLlmProvider(
      { ...OPTIONS, baseUrl: 'https://api.example.test/v1/' },
      http,
    ).complete(REQUEST);

    expect(calls[0].url).toBe('https://api.example.test/v1/chat/completions');
  });

  it('sends the key as a bearer token, and no header at all without one', async () => {
    const withKey = server(textReply);
    await new OpenAiCompatibleLlmProvider(OPTIONS, withKey.http).complete(
      REQUEST,
    );
    expect(withKey.calls[0].init.headers).toMatchObject({
      authorization: 'Bearer sk-test',
    });

    const keyless = server(textReply);
    await new OpenAiCompatibleLlmProvider(
      { ...OPTIONS, apiKey: undefined },
      keyless.http,
    ).complete(REQUEST);
    expect(keyless.calls[0].init.headers).not.toHaveProperty('authorization');
  });

  it('reads the first tool call and parses its JSON arguments', async () => {
    const { http } = server({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: null,
            tool_calls: [
              {
                function: {
                  name: 'inject_road_delay',
                  arguments: '{"districtId":"d-1","minutes":40}',
                },
              },
              { function: { name: 'noop', arguments: '{}' } },
            ],
          },
        },
      ],
    });

    const reply = await new OpenAiCompatibleLlmProvider(OPTIONS, http).complete(
      {
        ...REQUEST,
        tools: TOOLS,
      },
    );

    // One call a turn: the extra is dropped, not refused.
    expect(reply.toolCalls).toEqual([
      { name: 'inject_road_delay', input: { districtId: 'd-1', minutes: 40 } },
    ]);
    expect(reply.text).toBe('');
  });

  it('accepts arguments sent as an object, which some servers do', async () => {
    const { http } = server({
      choices: [
        {
          message: {
            tool_calls: [
              { function: { name: 'noop', arguments: { reason: 'on plan' } } },
            ],
          },
        },
      ],
    });

    const reply = await new OpenAiCompatibleLlmProvider(OPTIONS, http).complete(
      {
        ...REQUEST,
        tools: TOOLS,
      },
    );

    expect(reply.toolCalls).toEqual([
      { name: 'noop', input: { reason: 'on plan' } },
    ]);
  });

  it.each([
    ['a timeout', 429, true, '429'],
    ['an overloaded server', 503, true, '503'],
    ['a bad key', 401, false, '401'],
    ['an unknown model', 404, false, '404'],
  ])(
    'maps %s to a ProviderError that is retryable=%s',
    async (_why, status, retryable, code) => {
      const { http } = server('{"error":{"message":"nope"}}', { status });
      const provider = new OpenAiCompatibleLlmProvider(OPTIONS, http);

      const error: unknown = await provider
        .complete(REQUEST)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ProviderError);
      expect(error).toMatchObject({ retryable, providerCode: code });
    },
  );

  it('treats a server that never answers as retryable', async () => {
    const http = jest.fn(() =>
      Promise.reject(
        Object.assign(new Error('timed out'), { name: 'TimeoutError' }),
      ),
    ) as unknown as typeof fetch;

    const error: unknown = await new OpenAiCompatibleLlmProvider(OPTIONS, http)
      .complete(REQUEST)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ retryable: true });
  });

  it('turns a refusal into a ProviderError that is not retryable', async () => {
    const { http } = server({
      choices: [{ message: { content: null, refusal: 'I cannot help.' } }],
    });

    const error: unknown = await new OpenAiCompatibleLlmProvider(OPTIONS, http)
      .complete(REQUEST)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ retryable: false, providerCode: 'refusal' });
  });

  it.each([
    ['a body that is not a chat completion', { choices: [] }],
    [
      'tool arguments that are not JSON',
      {
        choices: [
          {
            message: {
              tool_calls: [{ function: { name: 'noop', arguments: '{oops' } }],
            },
          },
        ],
      },
    ],
  ])('refuses %s without retrying', async (_why, body) => {
    const { http } = server(body);

    const error: unknown = await new OpenAiCompatibleLlmProvider(OPTIONS, http)
      .complete({ ...REQUEST, tools: TOOLS })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ retryable: false });
  });

  it.each([
    ['LLM_BASE_URL', { ...OPTIONS, baseUrl: undefined }],
    ['LLM_MODEL', { ...OPTIONS, model: undefined }],
  ])(
    'says which variable is missing, and sends nothing',
    async (name, options) => {
      const { http, calls } = server(textReply);

      const error: unknown = await new OpenAiCompatibleLlmProvider(
        options,
        http,
      )
        .complete(REQUEST)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ProviderError);
      expect((error as ProviderError).message).toContain(name);
      expect((error as ProviderError).retryable).toBe(false);
      expect(calls).toHaveLength(0);
    },
  );

  it('answers health() from the base URL without sending anything', async () => {
    const { http, calls } = server(textReply);

    await expect(
      new OpenAiCompatibleLlmProvider(OPTIONS, http).health(),
    ).resolves.toBe(true);
    await expect(
      new OpenAiCompatibleLlmProvider(
        { ...OPTIONS, baseUrl: '' },
        http,
      ).health(),
    ).resolves.toBe(false);
    expect(calls).toHaveLength(0);
  });
});
