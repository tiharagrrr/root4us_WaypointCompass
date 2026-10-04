import type { GeoJSONSource, Map as MapLibreMap, Marker } from 'maplibre-gl'
import { useEffect, useRef, useState } from 'react'
import type { LngLat, MapModel } from './map-model'

/**
 * OpenFreeMap's light style: OpenStreetMap data, free, no API key, and close to the frame's pale
 * basemap. Attribution stays on the map, as the licence asks.
 */
export const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron'

/** A token's value, so the route lines use Compass colours and no hex. */
const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

const line = (coords: LngLat[]) => ({
  type: 'Feature' as const,
  properties: {},
  geometry: { type: 'LineString' as const, coordinates: coords },
})

function markerElement(className: string, label: string | null, title: string): HTMLElement {
  const el = document.createElement('div')
  el.className = 'map-marker'
  el.setAttribute('role', 'img')
  el.setAttribute('aria-label', title)
  const dot = document.createElement('span')
  dot.className = className
  el.appendChild(dot)
  if (label) {
    const tag = document.createElement('span')
    tag.className = 'map-tag'
    tag.textContent = label
    el.appendChild(tag)
  }
  return el
}

/**
 * The MapLibre canvas. Loaded on demand (it is the app's largest dependency), and it says so when
 * the browser has no WebGL rather than leaving a blank box. Markers are rebuilt from the model on
 * every change, which is cheap at a depot's few dozen points; the view is fitted once per trip.
 */
export function MapCanvas({ model, fitKey }: { model: MapModel; fitKey: string }) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)
  const markers = useRef<Marker[]>([])
  const fitted = useRef<string | null>(null)
  const lib = useRef<typeof import('maplibre-gl') | null>(null)
  const [failed, setFailed] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const maplibre = await import('maplibre-gl')
        await import('maplibre-gl/dist/maplibre-gl.css')
        if (cancelled || !container.current) return
        lib.current = maplibre
        const instance = new maplibre.Map({
          container: container.current,
          style: MAP_STYLE,
          center: [79.95, 7.0],
          zoom: 9,
          attributionControl: { compact: true },
        })
        instance.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right')
        instance.on('load', () => {
          const primary = token('--color-primary')
          const muted = token('--color-slate-400')
          instance.addSource('driven', { type: 'geojson', data: line([]) })
          instance.addSource('ahead', { type: 'geojson', data: line([]) })
          instance.addLayer({ id: 'driven', type: 'line', source: 'driven', paint: { 'line-color': primary, 'line-width': 4 } })
          instance.addLayer({
            id: 'ahead',
            type: 'line',
            source: 'ahead',
            paint: { 'line-color': muted, 'line-width': 3, 'line-dasharray': [1, 1.5] },
          })
          if (!cancelled) setReady(true)
        })
        map.current = instance
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
      for (const m of markers.current) m.remove()
      markers.current = []
      map.current?.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    const instance = map.current
    const maplibre = lib.current
    if (!ready || !instance || !maplibre) return
    ;(instance.getSource('driven') as GeoJSONSource | undefined)?.setData(line(model.driven))
    ;(instance.getSource('ahead') as GeoJSONSource | undefined)?.setData(line(model.ahead))

    for (const m of markers.current) m.remove()
    const add = (at: LngLat, el: HTMLElement) =>
      markers.current.push(new maplibre.Marker({ element: el, anchor: 'left', offset: [-8, 0] }).setLngLat(at).addTo(instance))
    markers.current = []
    if (model.depot) add(model.depot.at, markerElement('map-dot map-dot-depot', model.depot.label, model.depot.label))
    for (const stop of model.stops)
      add(stop.at, markerElement(`map-dot map-dot-${stop.tone}`, stop.label, stop.label ?? `Stop ${stop.seq ?? ''}`))
    for (const v of model.vehicles)
      add(
        v.at,
        markerElement(`map-dot map-dot-${v.tone}${v.selected ? ' map-dot-selected' : ''}`, v.label, v.label),
      )

    if (model.bounds && fitted.current !== fitKey) {
      fitted.current = fitKey
      instance.fitBounds(model.bounds, { padding: 64, maxZoom: 13, duration: 0 })
    }
  }, [model, fitKey, ready])

  if (failed)
    return (
      <p className="type-body m-0 p-6 text-muted-foreground">
        The map needs WebGL, which this browser has turned off. The trip list still updates live.
      </p>
    )
  // MapLibre sets position: relative on its container, so it is sized, not positioned.
  return <div ref={container} className="h-full w-full" data-testid="map-canvas" />
}
