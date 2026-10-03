import { usePlanBuildingRun, usePlanBuildingStartRun } from '@compass/api-client'
import { useEffect, useState } from 'react'

/**
 * Auto-suggest (05, 09): the API answers 202 with a RUNNING run and the worker finishes it
 * (AC-PLN-09). Until realtime reports the end (ROO-25) the screen polls the run once a second and
 * refreshes the plan when it ends.
 */
export function useAutoSuggest(planId: string, onDone: () => Promise<unknown>) {
  const start = usePlanBuildingStartRun()
  const [runId, setRunId] = useState<string | null>(null)
  const run = usePlanBuildingRun(planId, runId ?? '', {
    query: {
      enabled: runId !== null,
      refetchInterval: (query) => (query.state.data?.data.status === 'RUNNING' ? 1_000 : false),
    },
  })
  const status = run.data?.data.status

  useEffect(() => {
    if (runId === null || status === undefined || status === 'RUNNING') return
    void onDone()
    // The run row stays for its error; the next press starts a new one.
  }, [runId, status, onDone])

  const begin = async (headers: Record<string, string>) => {
    const res = await start.mutateAsync({
      id: planId,
      data: { mode: 'AUTO_SUGGEST', keepLocked: true },
      headers: { 'If-Match': headers['If-Match'] ?? '', 'Idempotency-Key': headers['Idempotency-Key'] },
    })
    setRunId(res.data.id)
  }

  return {
    begin,
    running: start.isPending || status === 'RUNNING',
    failed: status === 'FAILED' ? (run.data?.data.error ?? 'The run failed.') : null,
    error: start.error,
  }
}
