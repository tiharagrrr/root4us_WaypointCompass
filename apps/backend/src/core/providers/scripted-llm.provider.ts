import type { LlmProvider, LlmReply, LlmRequest } from './ports';

/**
 * LLM_PROVIDER=scripted: a keyless stand-in for local runs and tests. It reads
 * the JSON the caller sent and answers by rule, so the same prompt always gets
 * the same reply and nothing leaves the machine.
 *
 * With tools: one road delay in the first running trip's district while
 * nothing has been injected yet, then `noop`. Without tools: a one-line report
 * built from the numbers in the prompt.
 */
export class ScriptedLlmProvider implements LlmProvider {
  readonly name = 'scripted';

  complete(request: LlmRequest): Promise<LlmReply> {
    const state = parse(request.prompt);
    if (!request.tools?.length)
      return Promise.resolve(this.reply(report(state)));

    const has = (name: string) => request.tools?.some((t) => t.name === name);
    const trips = Array.isArray(state.trips) ? state.trips : [];
    const injected = Array.isArray(state.injected) ? state.injected : [];
    const running = trips.find(
      (t): t is { districtId: string } =>
        isRecord(t) &&
        t.status === 'IN_PROGRESS' &&
        typeof t.districtId === 'string',
    );
    if (running && !injected.length && has('inject_road_delay'))
      return Promise.resolve(
        this.reply('', {
          name: 'inject_road_delay',
          input: {
            districtId: running.districtId,
            speedIndex: 55,
            minutes: 40,
          },
        }),
      );
    return Promise.resolve(
      this.reply('', {
        name: 'noop',
        input: { reason: 'The day is on plan.' },
      }),
    );
  }

  health(): Promise<boolean> {
    return Promise.resolve(true);
  }

  private reply(text: string, call?: LlmReply['toolCalls'][number]): LlmReply {
    return { provider: this.name, text, toolCalls: call ? [call] : [] };
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function parse(prompt: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(prompt);
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

function report(state: Record<string, unknown>): string {
  const kpis = isRecord(state.kpis) ? state.kpis : {};
  const n = (key: string) => (typeof kpis[key] === 'number' ? kpis[key] : 0);
  return `Scripted report: ${n('stopsDelivered')} stops delivered, ${n('stopsFailed')} failed, ${n('injections')} injections fired.`;
}
