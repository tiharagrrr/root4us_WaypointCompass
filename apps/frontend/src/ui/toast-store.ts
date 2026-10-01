export type ToastTone = 'neutral' | 'success' | 'danger'

export interface ToastMessage {
  id: number
  title: string
  description?: string
  tone: ToastTone
}

type Listener = () => void

let toasts: readonly ToastMessage[] = []
let nextId = 1
const listeners = new Set<Listener>()

const emit = () => {
  for (const listener of listeners) listener()
}

export const toastStore = {
  subscribe: (listener: Listener): (() => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  getSnapshot: (): readonly ToastMessage[] => toasts,
  dismiss: (id: number): void => {
    toasts = toasts.filter((t) => t.id !== id)
    emit()
  },
}

/** Shows a toast from anywhere (a mutation's onSuccess, say). <Toaster> must be mounted once. */
export const toast = (message: { title: string; description?: string; tone?: ToastTone }): number => {
  const id = nextId
  nextId += 1
  toasts = [...toasts, { id, tone: 'neutral', ...message }]
  emit()
  return id
}
