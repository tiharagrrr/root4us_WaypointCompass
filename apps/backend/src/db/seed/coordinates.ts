import { createHash } from 'node:crypto';
import { and, eq, isNull, or } from 'drizzle-orm';
import { depots, districts, outlets } from '../schema';
import type { DbLike } from './db-like';

/**
 * Map positions, which the datasets don't carry (specs/data/datasets.md, Not in the datasets):
 * public coordinates of the two depots, every district's main town, and each town the outlets are
 * named after. An outlet sits near its town, nudged by its id so two brands in one town don't
 * stack, and always inland of the coast. Only empty coordinates are filled, so a position someone
 * corrected in A3 or A4 stays.
 */

type LatLng = readonly [lat: number, lng: number];

export const DEPOT_COORDS: Record<string, LatLng> = {
  PLG: [6.9608, 79.8847], // Peliyagoda, on the Kelani north of Colombo
  KDY: [7.3, 80.63], // Kandy, by Katugastota
};

/** Every district's main town, by slug: whichever districts the dataset holds get one. */
export const DISTRICT_CENTROIDS: Record<string, LatLng> = {
  colombo: [6.9271, 79.8612],
  gampaha: [7.0897, 79.9939],
  kalutara: [6.5854, 79.9607],
  kandy: [7.2906, 80.6337],
  matale: [7.4675, 80.6234],
  'nuwara-eliya': [6.9497, 80.7891],
  galle: [6.0535, 80.221],
  matara: [5.9549, 80.555],
  hambantota: [6.1241, 81.1185],
  jaffna: [9.6615, 80.0255],
  kilinochchi: [9.3803, 80.377],
  mannar: [8.981, 79.9044],
  vavuniya: [8.7514, 80.4971],
  mullaitivu: [9.2671, 80.8142],
  batticaloa: [7.731, 81.6747],
  ampara: [7.2975, 81.682],
  trincomalee: [8.5874, 81.2152],
  kurunegala: [7.4863, 80.3647],
  puttalam: [8.0362, 79.8283],
  anuradhapura: [8.3114, 80.4037],
  polonnaruwa: [7.9403, 81.0188],
  badulla: [6.9934, 81.055],
  monaragala: [6.8728, 81.3507],
  moneragala: [6.8728, 81.3507],
  ratnapura: [6.6828, 80.3992],
  kegalle: [7.2513, 80.3464],
};

/** The towns outlet-names.ts names outlets after. */
export const TOWN_COORDS: Record<string, LatLng> = {
  // Colombo
  Bambalapitiya: [6.8887, 79.8562],
  Kollupitiya: [6.91, 79.851],
  Wellawatte: [6.8746, 79.8608],
  Borella: [6.9147, 79.8778],
  Nugegoda: [6.8649, 79.8997],
  Dehiwala: [6.8511, 79.8659],
  Maharagama: [6.848, 79.9265],
  Kotte: [6.8905, 79.902],
  Rajagiriya: [6.909, 79.896],
  Battaramulla: [6.899, 79.918],
  Kottawa: [6.841, 79.965],
  Piliyandala: [6.8016, 79.922],
  Moratuwa: [6.773, 79.8816],
  'Mount Lavinia': [6.839, 79.865],
  Homagama: [6.8441, 80.0026],
  Kaduwela: [6.9336, 79.9846],
  Malabe: [6.9046, 79.958],
  Pettah: [6.9366, 79.851],
  Kirulapone: [6.879, 79.879],
  Narahenpita: [6.897, 79.878],
  // Gampaha
  Kadawatha: [7.001, 79.953],
  Wattala: [6.989, 79.892],
  'Ja-Ela': [7.0744, 79.8919],
  Kandana: [7.048, 79.897],
  Negombo: [7.2083, 79.8358],
  Seeduwa: [7.129, 79.878],
  Kiribathgoda: [6.98, 79.929],
  Ragama: [7.031, 79.922],
  Gampaha: [7.0897, 79.9939],
  Kelaniya: [6.9553, 79.922],
  Minuwangoda: [7.1667, 79.95],
  Veyangoda: [7.155, 80.058],
  Nittambuwa: [7.141, 80.096],
  Ganemulla: [7.064, 79.964],
  Delgoda: [6.987, 80.013],
  Divulapitiya: [7.224, 80.014],
  Katunayake: [7.17, 79.884],
  Mahara: [7.0, 79.959],
  Biyagama: [6.942, 79.989],
  // Kalutara
  Kalutara: [6.5854, 79.9607],
  Panadura: [6.713, 79.904],
  Wadduwa: [6.667, 79.93],
  Horana: [6.715, 80.063],
  Beruwala: [6.479, 79.983],
  Aluthgama: [6.434, 80.0],
  Matugama: [6.522, 80.114],
  Bandaragama: [6.714, 79.988],
  // Kandy
  Kandy: [7.2906, 80.6337],
  Peradeniya: [7.269, 80.594],
  Katugastota: [7.324, 80.623],
  Gampola: [7.164, 80.577],
  Kundasale: [7.281, 80.683],
  Digana: [7.296, 80.733],
  Akurana: [7.365, 80.617],
  Pilimathalawa: [7.266, 80.55],
  Nawalapitiya: [7.056, 80.534],
  Kadugannawa: [7.254, 80.524],
  // Matale
  Matale: [7.4675, 80.6234],
  Dambulla: [7.86, 80.6517],
  Rattota: [7.518, 80.678],
  Galewela: [7.759, 80.568],
  // Kurunegala
  Kurunegala: [7.4863, 80.3647],
  Kuliyapitiya: [7.469, 80.042],
  Polgahawela: [7.333, 80.3],
  Pannala: [7.329, 79.999],
  Narammala: [7.432, 80.216],
  Mawathagama: [7.432, 80.444],
  // Kegalle
  Kegalle: [7.2513, 80.3464],
  Mawanella: [7.253, 80.444],
  Warakapola: [7.227, 80.199],
  Rambukkana: [7.32, 80.392],
  // Nuwara Eliya
  'Nuwara Eliya': [6.9497, 80.7891],
  Hatton: [6.8916, 80.5955],
  Talawakele: [6.937, 80.658],
  'Nanu Oya': [6.944, 80.748],
  // Puttalam
  Chilaw: [7.5758, 79.7953],
  Puttalam: [8.0362, 79.8283],
  Wennappuwa: [7.349, 79.85],
  Marawila: [7.409, 79.832],
  // Ratnapura
  Ratnapura: [6.6828, 80.3992],
  Balangoda: [6.651, 80.699],
  Embilipitiya: [6.343, 80.849],
  Pelmadulla: [6.62, 80.542],
  // Badulla
  Badulla: [6.9934, 81.055],
  Bandarawela: [6.829, 80.99],
  Haputale: [6.768, 80.958],
  // Galle
  Galle: [6.0535, 80.221],
  Hikkaduwa: [6.14, 80.101],
  Ambalangoda: [6.235, 80.054],
  // Matara
  Matara: [5.9549, 80.555],
  Weligama: [5.975, 80.429],
};

/** Districts on the south coast, where "inland" is north rather than east. */
const SOUTH_COAST = new Set(['galle', 'matara', 'hambantota']);

/** About 400 m at Sri Lanka's latitude, in degrees. */
const NUDGE = 0.0036;

/** A fixed nudge per outlet id, between 0 and 1 on each axis. */
function unitsOf(id: string): [number, number] {
  const hash = createHash('sha256').update(id).digest();
  return [hash.readUInt16BE(0) / 0xffff, hash.readUInt16BE(2) / 0xffff];
}

/** "Fresh Kadawatha" or "Style Wattala 2" → the town; null when it isn't one we know. */
export function townOf(name: string): string | null {
  const rest = name.replace(/^(Fresh|Style|Tech) /, '').replace(/ \d+$/, '');
  return rest in TOWN_COORDS ? rest : null;
}

/**
 * Where an outlet goes: its town, else its district's main town, else its depot, nudged by its id.
 * The nudge only ever moves away from the sea: east on the west coast (everywhere), north on the
 * south coast.
 */
export function outletPosition(outlet: {
  id: string;
  name: string;
  districtId: string;
  depotId: string;
}): LatLng | null {
  const town = townOf(outlet.name);
  const base =
    (town && TOWN_COORDS[town]) ??
    DISTRICT_CENTROIDS[outlet.districtId] ??
    DEPOT_COORDS[outlet.depotId] ??
    null;
  if (!base) return null;
  const [u, v] = unitsOf(outlet.id);
  const lat = SOUTH_COAST.has(outlet.districtId)
    ? base[0] + u * NUDGE
    : base[0] + (u - 0.5) * 2 * NUDGE;
  const lng = base[1] + v * NUDGE;
  return [Number(lat.toFixed(6)), Number(lng.toFixed(6))];
}

/** Fills empty depot, district and outlet coordinates. Safe to run on every seed. */
export async function placeOnMap(db: DbLike): Promise<{ outlets: number }> {
  for (const [id, [lat, lng]] of Object.entries(DEPOT_COORDS))
    await db
      .update(depots)
      .set({ lat, lng })
      .where(
        and(eq(depots.id, id), or(isNull(depots.lat), isNull(depots.lng))),
      );
  for (const [id, [lat, lng]] of Object.entries(DISTRICT_CENTROIDS))
    await db
      .update(districts)
      .set({ centroidLat: lat, centroidLng: lng })
      .where(
        and(
          eq(districts.id, id),
          or(isNull(districts.centroidLat), isNull(districts.centroidLng)),
        ),
      );

  const empty = await db
    .select({
      id: outlets.id,
      name: outlets.name,
      districtId: outlets.districtId,
      depotId: outlets.depotId,
    })
    .from(outlets)
    .where(or(isNull(outlets.lat), isNull(outlets.lng)));
  let placed = 0;
  for (const outlet of empty) {
    const at = outletPosition(outlet);
    if (!at) continue;
    await db
      .update(outlets)
      .set({ lat: at[0], lng: at[1] })
      .where(eq(outlets.id, outlet.id));
    placed += 1;
  }
  return { outlets: placed };
}
