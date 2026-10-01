import type { ApiProblem } from '@compass/api-client'
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'

type ProblemLike = Pick<ApiProblem, 'code' | 'title' | 'detail' | 'errors'>

/** "lines[2].qty" from the API becomes react-hook-form's "lines.2.qty". */
export const toFormPath = (field: string): string => field.replace(/\[(\d+)\]/g, '.$1')

export interface ApplyProblemOptions {
  /** Form field paths that exist; errors for any other field go to root.server. Omit to map all. */
  fields?: readonly string[]
}

/**
 * Maps a problem's errors[] onto react-hook-form fields (specs/api-conventions.md, section 3).
 * Whatever cannot be shown on a field, or a problem with no field errors, goes to
 * errors.root.server. Returns true when at least one field error was set.
 */
export const applyProblem = <T extends FieldValues>(
  form: { setError: UseFormSetError<T> },
  problem: ProblemLike,
  options: ApplyProblemOptions = {},
): boolean => {
  const leftover: string[] = []
  let mapped = false
  for (const error of problem.errors) {
    const path = toFormPath(error.field)
    if (path === '' || (options.fields && !options.fields.includes(path))) {
      leftover.push(error.message)
      continue
    }
    form.setError(path as Path<T>, { type: error.code, message: error.message }, { shouldFocus: !mapped })
    mapped = true
  }
  if (!mapped || leftover.length > 0) {
    const message = leftover.length > 0 ? leftover.join(' ') : (problem.detail ?? problem.title)
    form.setError('root.server', { type: problem.code, message })
  }
  return mapped
}
