import { isApiProblem } from '@compass/api-client'
import { toast } from '@/ui/toast-store'

/**
 * A write the server refused, or that never reached it, as a toast in the problem's own words
 * (its title and detail), so no failed action is silent. `fallback` names what did not happen.
 */
export function toastProblem(error: unknown, fallback: string): void {
  const problem = isApiProblem(error) ? error : undefined
  toast({
    title: problem?.title ?? fallback,
    description: problem?.detail ?? (problem ? undefined : 'Check your connection and try again.'),
    tone: 'danger',
  })
}
