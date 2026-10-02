import type { EngineParams } from '../params';
import type { FairnessHistory } from '../types';

/**
 * Whether leaving this outlet's order off again is a repeat skip: it was deferred on its last run and
 * has been deferred at least `repeatSkipLookbackRuns` runs in a row. The REPEAT_SKIP rule and the
 * unplanned entries both use this, so they cannot disagree.
 */
export function isRepeatSkip(history: FairnessHistory | undefined, params: Pick<EngineParams, 'repeatSkipLookbackRuns'>): boolean {
  return history !== undefined && history.deferredOnLastRun && history.consecutiveDeferrals >= params.repeatSkipLookbackRuns;
}
