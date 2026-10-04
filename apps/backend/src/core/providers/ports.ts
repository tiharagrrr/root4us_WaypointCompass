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
 * deterministic), `anthropic`, or `openai-compatible` for any server that
 * speaks the OpenAI chat completions API; with `disabled`, the default, the
 * token resolves to null and nothing is ever sent anywhere.
 */
export interface LlmProvider {
  readonly name: string;
  complete(request: LlmRequest): Promise<LlmReply>;
  /** Cheap, and sends nothing. */
  health(): Promise<boolean>;
}

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

/** One SMS on its way out. */
export interface SmsMessage {
  /** E.164 (+94...); every adapter normalises what it is given. */
  to: string;
  /** Already rendered and GSM-7 safe; an adapter never edits it. */
  text: string;
  /**
   * The notification row id, or the job id for a sign-in code. Adapters pass
   * it to gateways that support one, so a retried job never sends twice.
   */
  idempotencyKey?: string;
  /**
   * Overrides the configured sender id (a registered mask such as
   * WayPoint). Only a gateway that allows more than one has a use for it.
   */
  senderId?: string;
}

/** What a gateway accepted, and under which id a receipt will name it. */
export interface SendResult {
  provider: string;
  providerMessageId: string;
}

/**
 * An SMS gateway. SMS_PROVIDER picks the adapter: `demo-inbox` (keyless, the
 * default, puts messages in /api/v1/demo/inbox), `notifylk` or `textlk` (both
 * Sri Lankan, cheap local routes), or `twilio` for international numbers.
 * Only worker jobs send; nothing here is called during a request.
 */
export interface SmsProvider {
  readonly name: string;
  send(message: SmsMessage): Promise<SendResult>;
  /** Cheap, and sends nothing. */
  health(): Promise<boolean>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
