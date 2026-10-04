import { ProviderError } from './ports';

/** A gateway that has not answered in 10 s has lost its turn; the job retries. */
export const SMS_TIMEOUT_MS = 10_000;
/** Enough of a refusal to name the cause in a log line. */
const DETAIL_CHARS = 200;

/**
 * The one HTTP call every SMS adapter makes, with the retryable rule the
 * provider-adapter skill sets: a timeout, a refused connection, 429 and 5xx
 * are worth another attempt; any other 4xx (an invalid number, a sender id
 * that is not registered, no credit) ends the notification FAILED.
 */
export async function postToGateway(
  http: typeof fetch,
  gateway: string,
  url: string,
  init: RequestInit,
): Promise<unknown> {
  let response: Response;
  try {
    response = await http(url, {
      ...init,
      signal: AbortSignal.timeout(SMS_TIMEOUT_MS),
    });
  } catch (error: unknown) {
    throw new ProviderError(`${gateway} ${reasonOf(error, gateway)}`, true);
  }
  const text = await response.text().catch(() => '');
  if (!response.ok)
    throw new ProviderError(
      `${gateway} answered ${response.status}${text ? `: ${text.slice(0, DETAIL_CHARS)}` : ''}`,
      response.status === 429 || response.status >= 500,
      String(response.status),
    );
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProviderError(`${gateway} sent a body that is not JSON`, false);
  }
}

function reasonOf(error: unknown, gateway: string): string {
  if (error instanceof Error && error.name === 'TimeoutError')
    return `did not answer within ${SMS_TIMEOUT_MS / 1_000}s`;
  return error instanceof Error ? error.message : `is away (${gateway})`;
}
