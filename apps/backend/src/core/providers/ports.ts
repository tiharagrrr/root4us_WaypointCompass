/**
 * Ports for outside services (provider-adapter skill). Configuration picks the
 * adapter, the local default needs no key, and tests never reach the internet.
 */

/** A provider's refusal; `retryable` says whether trying again could help. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly providerCode?: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** A tool the model may call: a name, what it does and its JSON Schema. */
export interface LlmTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface LlmToolCall {
  name: string;
  input: unknown;
}

export interface LlmRequest {
  system: string;
  /** The one user message. */
  prompt: string;
  /** With tools, the model answers with at most one call. */
  tools?: LlmTool[];
}

export interface LlmReply {
  provider: string;
  text: string;
  toolCalls: LlmToolCall[];
}

/**
 * A language model. LLM_PROVIDER picks the adapter: `scripted` (keyless,
 * deterministic) or `anthropic`; with `disabled`, the default, the token
 * resolves to null and nothing is ever sent anywhere.
 */
export interface LlmProvider {
  readonly name: string;
  complete(request: LlmRequest): Promise<LlmReply>;
  /** Cheap, and sends nothing. */
  health(): Promise<boolean>;
}

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
