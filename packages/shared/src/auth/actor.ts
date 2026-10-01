import type { UserRole } from "../domain";

/**
 * The signed-in person making a request, built once per request by the API's
 * ActorGuard from the session. The role decides what they may do; the scope
 * fields decide which rows they may touch.
 */
export interface Actor {
  id: string;
  name: string;
  role: UserRole;
  /** Dispatcher (null = all depots), loader and driver. */
  depotId: string | null;
  /** Store manager. */
  outletId: string | null;
  /** A driver's default vehicle. */
  vehicleId: string | null;
  /** From the x-device-id header, when the client sends one. */
  deviceId: string | null;
}
