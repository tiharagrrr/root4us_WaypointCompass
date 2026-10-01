import { isRouteErrorResponse, Link, useRouteError } from 'react-router'
import { ErrorState } from '@/ui/states'

/** Route-level error boundary: unknown paths and errors thrown while rendering. */
export function RouteError() {
  const error = useRouteError()
  const notFound = isRouteErrorResponse(error) && error.status === 404
  return (
    <main className="mx-auto flex max-w-[640px] flex-col gap-4 px-4 py-12">
      {notFound ? (
        <>
          <h1 className="type-page-title m-0">Page not found</h1>
          <p className="type-body m-0 text-muted-foreground">There is nothing at this address.</p>
        </>
      ) : (
        <ErrorState error={error} onRetry={() => window.location.reload()} />
      )}
      <Link to="/" className="type-body text-primary">
        Go to the start page
      </Link>
    </main>
  )
}
