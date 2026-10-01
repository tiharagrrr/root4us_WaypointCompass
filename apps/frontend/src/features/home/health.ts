import { useQuery } from '@tanstack/react-query'

export interface HealthStatus {
  status: 'ok' | 'error'
  info?: Record<string, { status: string }>
  error?: Record<string, { status: string; message?: string }>
}

/**
 * The one hand-written request in the app: health lives outside /api/v1 and Caddy exposes it as
 * /api/health, while the generated healthCheck calls /health, which the dev proxy does not forward.
 */
const fetchHealth = async (): Promise<HealthStatus> => {
  const res = await fetch('/api/health')
  return (await res.json()) as HealthStatus
}

export const useHealth = () => useQuery({ queryKey: ['health'], queryFn: fetchHealth, refetchInterval: 15_000 })
