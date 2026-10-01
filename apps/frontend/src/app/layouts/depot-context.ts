import { DEPOTS, type Depot } from '@waypoint/shared/domain'
import { createContext, useContext } from 'react'

export interface DepotState {
  /** The depot the dispatcher is looking at: their own, or the one picked in the header switch. */
  depot: Depot
  setDepot: (depot: Depot) => void
}

export const DepotContext = createContext<DepotState>({ depot: DEPOTS[0], setDepot: () => undefined })

/** The dispatcher's current depot. Screens key their queries on it. */
export const useDepot = (): DepotState => useContext(DepotContext)

export const isDepot = (value: unknown): value is Depot => typeof value === 'string' && (DEPOTS as readonly string[]).includes(value)
