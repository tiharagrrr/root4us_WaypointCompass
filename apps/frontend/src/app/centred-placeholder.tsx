import { Card, CardContent } from '@/ui/card'
import { Wordmark } from '@/ui/wordmark'

/** The sign-in shell: a centred card on the page background (A0). */
export function CentredPlaceholder({ code, name, node }: { code: string; name: string; node?: string }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-3 bg-page px-4">
      <Wordmark />
      <Card className="w-full max-w-[400px]">
        <CardContent className="flex flex-col gap-1 p-5">
          <p className="type-label m-0 uppercase text-muted-foreground">
            {node ? `${code} · Figma ${node}` : code}
          </p>
          <p className="type-title m-0 text-foreground">{name}</p>
          <p className="type-body m-0 text-muted-foreground">This screen is not built yet.</p>
        </CardContent>
      </Card>
    </div>
  )
}
