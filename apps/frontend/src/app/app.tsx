import { QueryClientProvider } from '@tanstack/react-query'
import { useEffect } from 'react'
import { RouterProvider } from 'react-router/dom'
import { Toaster } from '@/ui/toast'
import { redirectToSignInOn401 } from './auth-redirect'
import { queryClient } from './query-client'
import { router } from './router'

export function App() {
  useEffect(() => redirectToSignInOn401(), [])
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  )
}
