import Anthropic from '@anthropic-ai/sdk';
import {
  type LlmProvider,
  type LlmReply,
  type LlmRequest,
  ProviderError,
} from './ports';

/** Short answers: one tool call or a few sentences of report. */
const MAX_TOKENS = 4096;
/** Declined requests re-run on Anthropic's recommended fallback model. */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
/** Used when LLM_MODEL is unset. */
const DEFAULT_MODEL = 'claude-opus-5-5';

/**
 * LLM_PROVIDER=anthropic: Claude through the Messages API. With tools, the
 * model may answer with at most one call (parallel tool use is off), and each
 * tool is strict, so its input matches the schema.
 */
export class AnthropicLlmProvider implements LlmProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;

  constructor(
    private readonly options: { apiKey?: string; model?: string },
    client?: Anthropic,
  ) {
    this.client =
      client ?? new Anthropic({ apiKey: options.apiKey, maxRetries: 1 });
  }

  async complete(request: LlmRequest): Promise<LlmReply> {
    if (!this.options.apiKey)
      throw new ProviderError(
        'LLM_PROVIDER=anthropic needs ANTHROPIC_API_KEY',
        false,
      );
    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await this.client.beta.messages.create({
        model: this.options.model ?? DEFAULT_MODEL,
        max_tokens: MAX_TOKENS,
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
        output_config: { effort: 'low' },
        system: request.system,
        messages: [{ role: 'user', content: request.prompt }],
        ...(request.tools?.length && {
          tools: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema:
              tool.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
            strict: true,
          })),
          tool_choice: { type: 'auto', disable_parallel_tool_use: true },
        }),
      });
    } catch (error: unknown) {
      if (error instanceof Anthropic.RateLimitError)
        throw new ProviderError(error.message, true, '429');
      if (error instanceof Anthropic.APIConnectionError)
        throw new ProviderError(error.message, true);
      if (error instanceof Anthropic.APIError)
        throw new ProviderError(
          error.message,
          typeof error.status === 'number' && error.status >= 500,
          error.status === undefined ? undefined : String(error.status),
        );
      throw error;
    }
    if (message.stop_reason === 'refusal')
      throw new ProviderError(
        'The model declined the request',
        false,
        'refusal',
      );

    const reply: LlmReply = { provider: this.name, text: '', toolCalls: [] };
    for (const block of message.content) {
      if (block.type === 'text') reply.text += block.text;
      if (block.type === 'tool_use')
        reply.toolCalls.push({ name: block.name, input: block.input });
    }
    return reply;
  }

  health(): Promise<boolean> {
    return Promise.resolve(Boolean(this.options.apiKey));
  }
}
