import { z } from 'zod';
import {
  type LlmProvider,
  type LlmReply,
  type LlmRequest,
  ProviderError,
} from './ports';

/** Short answers: one tool call or a few sentences of report. */
const MAX_TOKENS = 4096;
/** A stalled server must never hold a simulation tick open. */
const TIMEOUT_MS = 30_000;
/** Enough of a failed body to name the cause in a log line. */
const DETAIL_CHARS = 200;

/**
 * LLM_PROVIDER=openai-compatible: any server that speaks the OpenAI chat
 * completions API. LLM_BASE_URL carries the version path, so OpenAI
 * (https://api.openai.com/v1), a gateway (OpenRouter, Groq, Together) or a
 * local server (vLLM, Ollama, LM Studio) all work; LLM_API_KEY is optional,
 * because a local server usually wants no key.
 *
 * The request stays inside the part of that API every server implements:
 * `max_tokens` rather than `max_completion_tokens`, plain function tools with
 * no `strict`, and no `parallel_tool_calls`, since a third-party server
 * rejects or silently drops the newer fields. The director takes one call a
 * turn, so extra calls are dropped here instead of being refused.
 */
export class OpenAiCompatibleLlmProvider implements LlmProvider {
  readonly name = 'openai-compatible';

  constructor(
    private readonly options: {
      baseUrl?: string;
      apiKey?: string;
      model?: string;
    },
    private readonly http: typeof fetch = globalThis.fetch,
  ) {}

  async complete(request: LlmRequest): Promise<LlmReply> {
    const { baseUrl, model } = this.options;
    if (!baseUrl)
      throw new ProviderError(
        'LLM_PROVIDER=openai-compatible needs LLM_BASE_URL',
        false,
      );
    if (!model)
      throw new ProviderError(
        'LLM_PROVIDER=openai-compatible needs LLM_MODEL',
        false,
      );

    const body = await this.post(
      `${baseUrl.replace(/\/+$/, '')}/chat/completions`,
      {
        model,
        max_tokens: MAX_TOKENS,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.prompt },
        ],
        ...(request.tools?.length && {
          tools: request.tools.map((tool) => ({
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema,
            },
          })),
          tool_choice: 'auto',
        }),
      },
    );
    return this.read(body);
  }

  /** Cheap, and sends nothing: a base URL is all this adapter needs. */
  health(): Promise<boolean> {
    return Promise.resolve(Boolean(this.options.baseUrl));
  }

  private async post(url: string, body: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await this.http(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // No key at all is valid: a local server does not ask for one.
          ...(this.options.apiKey && {
            authorization: `Bearer ${this.options.apiKey}`,
          }),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error: unknown) {
      // A timeout, a refused connection or DNS: trying again could help.
      throw new ProviderError(reasonOf(error), true);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ProviderError(
        `the model server answered ${response.status}${
          detail ? `: ${detail.slice(0, DETAIL_CHARS)}` : ''
        }`,
        response.status === 429 || response.status >= 500,
        String(response.status),
      );
    }
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new ProviderError(
        'the model server sent a body that is not JSON',
        false,
      );
    }
  }

  private read(body: unknown): LlmReply {
    const parsed = completion.safeParse(body);
    if (!parsed.success)
      throw new ProviderError(
        'the model server sent an unexpected chat completion',
        false,
      );
    const choice = parsed.data.choices[0];
    if (choice.message.refusal || choice.finish_reason === 'content_filter')
      throw new ProviderError(
        'the model declined the request',
        false,
        'refusal',
      );

    const reply: LlmReply = {
      provider: this.name,
      text: choice.message.content ?? '',
      toolCalls: [],
    };
    const [call] = choice.message.tool_calls ?? [];
    if (call)
      reply.toolCalls.push({
        name: call.function.name,
        input: inputOf(call.function.arguments),
      });
    return reply;
  }
}

/**
 * Only the fields this adapter reads, each loose enough for the servers that
 * differ: `content` is null on a tool call, and `arguments` is a JSON string
 * in the specification but an object on some servers.
 */
const completion = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullish(),
        message: z.object({
          content: z.string().nullish(),
          refusal: z.string().nullish(),
          tool_calls: z
            .array(
              z.object({
                function: z.object({
                  name: z.string(),
                  arguments: z
                    .union([z.string(), z.record(z.string(), z.unknown())])
                    .nullish(),
                }),
              }),
            )
            .nullish(),
        }),
      }),
    )
    .min(1),
});

/** A tool call's arguments, whichever of the two shapes the server sent. */
function inputOf(
  args: string | Record<string, unknown> | null | undefined,
): unknown {
  if (args === null || args === undefined || args === '') return {};
  if (typeof args !== 'string') return args;
  try {
    return JSON.parse(args) as unknown;
  } catch {
    throw new ProviderError(
      'the model sent tool arguments that are not JSON',
      false,
    );
  }
}

function reasonOf(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError')
    return `the model server did not answer within ${TIMEOUT_MS / 1_000}s`;
  return error instanceof Error ? error.message : 'the model server is away';
}
