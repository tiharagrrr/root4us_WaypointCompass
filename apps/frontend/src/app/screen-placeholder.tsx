import { Card, CardContent } from '@/ui/card'

export interface ScreenPlaceholderProps {
  /** Frame code from specs/frontend/screens.md, e.g. A1. */
  code: string
  name: string
  /** Figma node id. */
  node: string
}

/**
 * Stands in for a screen until its frame is built (react-screen skill). `code` and `node` stay on
 * the props for traceability with specs/frontend/screens.md; they are never shown to a user.
 */
export function ScreenPlaceholder({ name }: ScreenPlaceholderProps) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1">
        <p className="type-body-strong m-0 text-foreground">{name}</p>
        <p className="type-body m-0 text-muted-foreground">This screen is not built yet.</p>
      </CardContent>
    </Card>
  )
}

export interface RegionPlaceholderProps {
  /** The region's name in the frame, e.g. "Today's runs". */
  region: string
  /** Frame code from specs/frontend/screens.md. */
  frame: string
  node: string
  /** The module whose owner builds it. */
  owner: string
  /** What it will show, so the next person does not have to re-read the frame. */
  what: string
}

/**
 * Stands in for one region of a frame that another module owns. Several of
 * the dispatcher's frames are shared — 01 is alerts and planning, 19 and 19a
 * are execution and alerts — so a half-built frame says which half is
 * missing and who builds it, instead of looking finished or looking broken.
 */
export function RegionPlaceholder({ region, what }: RegionPlaceholderProps) {
  return (
    <Card className="border-dashed bg-page shadow-none">
      <CardContent className="flex flex-col gap-1">
        <p className="type-body-strong m-0 text-foreground">{region}</p>
        <p className="type-body m-0 text-muted-foreground">{what}</p>
      </CardContent>
    </Card>
  )
}
