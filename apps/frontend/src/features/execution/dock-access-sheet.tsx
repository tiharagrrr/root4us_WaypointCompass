// Figma: D9 Dock & access · 185:20487
import { useTranslation } from 'react-i18next'
import type { CachedStop } from '@/offline'
import { Button } from '@/ui/button'
import { Card, CardContent } from '@/ui/card'
import { Sheet, SheetBody, SheetClose, SheetContent, SheetFooter, SheetHeader } from '@/ui/sheet'

export interface DockAccessSheetProps {
  stop: CachedStop
  /** 1-based position in the trip, for the sheet's subtitle. */
  seq: number
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Everything a driver needs to get the crate through the door, read from the bundle on the phone:
 * this is the one screen that has to work in a basement loading bay with no signal (AC-EXE-04).
 *
 * The number is a `tel:` link, not a copyable string — a driver reversing a reefer has one hand.
 */
export function DockAccessSheet({ stop, seq, open, onOpenChange }: DockAccessSheetProps) {
  const { t } = useTranslation()

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom">
        <SheetHeader
          title={t('driver.dockAndAccessTitle')}
          description={t('driver.stopNamed', { n: seq, name: stop.outletName })}
        />
        <SheetBody className="gap-3.5">
          <Card className="w-full">
            <CardContent className="flex items-center gap-3 px-4 py-3">
              <div className="flex min-w-0 flex-1 flex-col gap-px">
                <p className="type-label m-0 uppercase text-muted-foreground">
                  {t('driver.receivingContact')}
                </p>
                {stop.contactName || stop.contactPhone ? (
                  <>
                    <p className="type-body-strong m-0 text-[15px] text-foreground">
                      {stop.contactName ?? stop.contactPhone}
                    </p>
                    {stop.contactPhone ? (
                      <p className="type-metadata m-0 text-muted-foreground">{stop.contactPhone}</p>
                    ) : null}
                  </>
                ) : (
                  <p className="type-body m-0 text-muted-foreground">{t('driver.noContact')}</p>
                )}
              </div>
              {stop.contactPhone ? (
                <Button asChild variant="outline" className="h-11 px-[21px] text-[15px]">
                  <a href={`tel:${stop.contactPhone.replace(/\s/g, '')}`}>{t('driver.call')}</a>
                </Button>
              ) : null}
            </CardContent>
          </Card>

          <section className="flex flex-col gap-[3px] border-t border-slate-100 pt-[13px]">
            <p className="type-label m-0 uppercase text-muted-foreground">{t('driver.accessNotes')}</p>
            <p className="type-field-label m-0 whitespace-pre-line text-foreground">
              {stop.accessNote ?? t('driver.noAccessNotes')}
            </p>
          </section>
        </SheetBody>
        <SheetFooter>
          <SheetClose asChild>
            <Button variant="outline" className="h-[52px] w-full text-[16px]">
              {t('driver.backToStop')}
            </Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
