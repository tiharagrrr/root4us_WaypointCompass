// Figma: L3 Flag an item · 185:19537 (Card / Add photo, the dashed drop zone)
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { db, uuidv7 } from '@/offline'
import { Icon } from '@/ui/icon'

export interface FlagPhotoFieldProps {
  /** Called with the attachment's clientUuid once the photo is on the device. */
  onPhoto: (clientUuid: string | undefined) => void
}

/**
 * The photo of the broken tray, queued beside the flag. It is written to Dexie as a Blob under its
 * own clientUuid and uploaded on its own retry, so a flag raised with no signal still carries its
 * evidence when the dock comes back (specs/loading/spec.md, Offline).
 */
export function FlagPhotoField({ onPhoto }: FlagPhotoFieldProps) {
  const { t } = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  const [name, setName] = useState<string | null>(null)

  const take = async (file: File | undefined) => {
    if (!file) return
    const clientUuid = uuidv7()
    await db.attachments.put({ clientUuid, blob: file, contentType: file.type, kind: 'photo', status: 'pending', attempts: 0, attachmentId: null })
    setName(file.name)
    onPhoto(clientUuid)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="type-label m-0 uppercase text-muted-foreground">{t('loading.flag.photo')}</p>
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="flex h-[82px] cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 bg-page outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <Icon name="camera" size={18} className="text-muted-foreground" />
        <span className="type-body text-muted-foreground">{name ?? t('loading.flag.addPhoto')}</span>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        aria-label={t('loading.flag.addPhoto')}
        onChange={(event) => void take(event.target.files?.[0])}
      />
    </div>
  )
}
