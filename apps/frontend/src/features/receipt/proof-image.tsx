import { useAttachmentsDownload } from '@compass/api-client'
import { Skeleton } from '@/ui/skeleton'

/**
 * A file the driver captured, opened through the attachment's own link: the API answers with a
 * short-lived URL to the store, so the bytes never pass through it (AC-RCP-15).
 */
export function ProofImage({ id, label, empty }: { id: string | null; label: string; empty: string }) {
  const link = useAttachmentsDownload(id ?? '', { query: { enabled: Boolean(id) } })
  if (!id)
    return (
      <div className="flex h-[88px] items-center justify-center rounded-md border border-border bg-page">
        <span className="type-body-small font-mono text-muted-foreground">{empty}</span>
      </div>
    )
  if (link.isPending) return <Skeleton className="h-[88px] w-full" />
  const url = link.data?.data.url
  return (
    <div className="flex h-[88px] items-center justify-center overflow-hidden rounded-md border border-border bg-background">
      {url ? (
        <img src={url} alt={label} className="max-h-full max-w-full object-contain" />
      ) : (
        <span className="type-body-small text-muted-foreground">Couldn’t load the {label.toLowerCase()}</span>
      )}
    </div>
  )
}
