import { asc, eq } from 'drizzle-orm';
import { outlets } from '../schema';
import type { DbLike } from './db-like';

/** The persona outlet (README, seeded accounts): its name is fixed. */
export const PERSONA_OUTLET = {
  id: 'OUT014',
  name: 'Fresh Kadawatha',
} as const;

/**
 * Towns per district slug, in a fixed order, for "Brand Town" names (specs/data/datasets.md,
 * Not in the datasets). Kadawatha is kept for the persona outlet. A district not listed keeps
 * the placeholder name.
 */
const TOWNS: Record<string, readonly string[]> = {
  colombo: [
    'Bambalapitiya',
    'Kollupitiya',
    'Wellawatte',
    'Borella',
    'Nugegoda',
    'Dehiwala',
    'Maharagama',
    'Kotte',
    'Rajagiriya',
    'Battaramulla',
    'Kottawa',
    'Piliyandala',
    'Moratuwa',
    'Mount Lavinia',
    'Homagama',
    'Kaduwela',
    'Malabe',
    'Pettah',
    'Kirulapone',
    'Narahenpita',
  ],
  gampaha: [
    'Wattala',
    'Ja-Ela',
    'Kandana',
    'Negombo',
    'Seeduwa',
    'Kiribathgoda',
    'Ragama',
    'Gampaha',
    'Kelaniya',
    'Minuwangoda',
    'Veyangoda',
    'Nittambuwa',
    'Ganemulla',
    'Delgoda',
    'Divulapitiya',
    'Katunayake',
    'Mahara',
    'Biyagama',
  ],
  kalutara: [
    'Kalutara',
    'Panadura',
    'Wadduwa',
    'Horana',
    'Beruwala',
    'Aluthgama',
    'Matugama',
    'Bandaragama',
  ],
  kandy: [
    'Kandy',
    'Peradeniya',
    'Katugastota',
    'Gampola',
    'Kundasale',
    'Digana',
    'Akurana',
    'Pilimathalawa',
    'Nawalapitiya',
    'Kadugannawa',
  ],
  matale: ['Matale', 'Dambulla', 'Rattota', 'Galewela'],
  kurunegala: [
    'Kurunegala',
    'Kuliyapitiya',
    'Polgahawela',
    'Pannala',
    'Narammala',
    'Mawathagama',
  ],
  kegalle: ['Kegalle', 'Mawanella', 'Warakapola', 'Rambukkana'],
  'nuwara-eliya': ['Nuwara Eliya', 'Hatton', 'Talawakele', 'Nanu Oya'],
  puttalam: ['Chilaw', 'Puttalam', 'Wennappuwa', 'Marawila'],
  ratnapura: ['Ratnapura', 'Balangoda', 'Embilipitiya', 'Pelmadulla'],
  badulla: ['Badulla', 'Bandarawela', 'Haputale'],
  galle: ['Galle', 'Hikkaduwa', 'Ambalangoda'],
  matara: ['Matara', 'Weligama'],
};

const WORD: Record<string, string> = {
  FRESH: 'Fresh',
  STYLE: 'Style',
  TECH: 'Tech',
};

/**
 * An outlet's generated name: the brand, then the district's next town ("Fresh Wattala"), with a
 * number once a district runs out of towns. `index` is the outlet's place among its brand's
 * outlets in the district, by id. Null when the district has no town list.
 */
export function outletName(
  outlet: { id: string; brand: string; districtId: string },
  index: number,
): string | null {
  if (outlet.id === PERSONA_OUTLET.id && outlet.brand === 'FRESH')
    return PERSONA_OUTLET.name;
  const towns = TOWNS[outlet.districtId];
  if (!towns?.length) return null;
  const town = towns[index % towns.length];
  const round = Math.floor(index / towns.length);
  return `${WORD[outlet.brand] ?? outlet.brand} ${town}${round ? ` ${round + 1}` : ''}`;
}

/** The reference seed's placeholder ("Fresh Gampaha 3"), which a generated name replaces. */
const PLACEHOLDER = /^(Fresh|Style|Tech) .+ \d+$/;

/**
 * Names the outlets that still carry a placeholder. A name someone changed in A3 is left alone,
 * so this is safe to run on every seed.
 */
export async function nameOutlets(db: DbLike): Promise<number> {
  const rows = await db
    .select({
      id: outlets.id,
      name: outlets.name,
      brand: outlets.brand,
      districtId: outlets.districtId,
    })
    .from(outlets)
    .orderBy(asc(outlets.id));
  const seen = new Map<string, number>();
  let renamed = 0;
  for (const row of rows) {
    const key = `${row.brand}:${row.districtId}`;
    const index = seen.get(key) ?? 0;
    // The persona takes Kadawatha, which is not in the rotation, so it does not use a slot.
    if (row.id !== PERSONA_OUTLET.id) seen.set(key, index + 1);
    if (!PLACEHOLDER.test(row.name) && row.id !== PERSONA_OUTLET.id) continue;
    const name = outletName(row, index);
    if (!name || name === row.name) continue;
    await db.update(outlets).set({ name }).where(eq(outlets.id, row.id));
    renamed += 1;
  }
  return renamed;
}
