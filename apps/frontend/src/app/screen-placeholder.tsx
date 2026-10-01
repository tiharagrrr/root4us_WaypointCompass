import { Card, CardContent } from '@/ui/card'

export interface ScreenPlaceholderProps {
  /** Frame code from specs/frontend/screens.md, e.g. A1. */
  code: string
  name: string
  /** Figma node id. */
  node: string
}

/** Stands in for a screen until its frame is built (react-screen skill). */
export function ScreenPlaceholder({ code, name, node }: ScreenPlaceholderProps) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1">
        <p className="type-label m-0 uppercase text-muted-foreground">
          {code} · Figma {node}
        </p>
        <p className="type-body-strong m-0 text-foreground">{name}</p>
        <p className="type-body m-0 text-muted-foreground">This screen is not built yet.</p>
      </CardContent>
    </Card>
  )
}
