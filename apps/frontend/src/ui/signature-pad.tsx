import { useCallback, useEffect, useImperativeHandle, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { cn } from '@/lib/cn'

// Figma: "Card / SIGN HERE" in D4 Record stop (185:20229). A bordered box with the signing line and
// its label near the bottom; the driver signs on the glass with a finger.
export interface SignaturePadHandle {
  /** The signature as a PNG, or null when nothing has been drawn. */
  toBlob: () => Promise<Blob | null>
  clear: () => void
  isEmpty: () => boolean
}

export interface SignaturePadProps {
  ref?: RefObject<SignaturePadHandle | null>
  label: string
  /** Announced to the driver and used as the control's accessible name. */
  'aria-label'?: string
  onDrawnChange?: (drawn: boolean) => void
  className?: string
}

/**
 * Signing is the one place a driver draws rather than taps, so this is a canvas and not an input.
 * It keeps the strokes at the device's pixel ratio, exports a PNG for the attachment queue, and
 * never touches the network: the Blob goes into Dexie and uploads on its own retry (AC-EXE-16).
 */
export function SignaturePad({ ref, label, onDrawnChange, className, ...aria }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const [drawn, setDrawn] = useState(false)

  // The canvas is sized in device pixels so a finger stroke is not a staircase on a phone.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ratio = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = Math.max(1, Math.floor(rect.width * ratio))
    canvas.height = Math.max(1, Math.floor(rect.height * ratio))
    const context = canvas.getContext('2d')
    if (!context) return
    context.scale(ratio, ratio)
    context.lineWidth = 2
    context.lineCap = 'round'
    context.lineJoin = 'round'
    // The ink is the canvas's own text colour (text-foreground), so the stroke follows the
    // Compass token rather than a colour written into this file.
    context.strokeStyle = getComputedStyle(canvas).color
  }, [])

  const pointOf = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const begin = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const context = canvasRef.current?.getContext('2d')
    if (!context) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    drawing.current = true
    const { x, y } = pointOf(event)
    context.beginPath()
    context.moveTo(x, y)
  }

  const move = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const context = canvasRef.current?.getContext('2d')
    if (!context) return
    const { x, y } = pointOf(event)
    context.lineTo(x, y)
    context.stroke()
    if (!drawn) {
      setDrawn(true)
      onDrawnChange?.(true)
    }
  }

  const end = () => {
    drawing.current = false
  }

  const clear = useCallback(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    setDrawn(false)
    onDrawnChange?.(false)
  }, [onDrawnChange])

  useImperativeHandle(
    ref,
    () => ({
      isEmpty: () => !drawn,
      clear,
      toBlob: () =>
        new Promise<Blob | null>((resolve) => {
          const canvas = canvasRef.current
          if (!canvas || !drawn) return resolve(null)
          if (typeof canvas.toBlob !== 'function') return resolve(null)
          canvas.toBlob((blob) => resolve(blob), 'image/png')
        }),
    }),
    [clear, drawn],
  )

  return (
    <div
      data-slot="signature-pad"
      className={cn('relative h-[98px] w-full rounded-md border border-input bg-background', className)}
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={aria['aria-label'] ?? label}
        className="size-full touch-none rounded-md text-foreground"
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-3 bottom-4 border-t border-slate-200" />
      <span
        aria-hidden="true"
        className="type-mono-small pointer-events-none absolute bottom-[21px] left-3 text-[10px] uppercase text-slate-400"
      >
        {label}
      </span>
    </div>
  )
}
