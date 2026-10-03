import type { Brand, TempClass } from '@waypoint/shared';
import { sql } from 'drizzle-orm';
import { items } from '../schema';
import type { DbLike } from './db-like';

/** One catalog item as the seed writes it (specs/data/datasets.md, Not in the datasets). */
export interface CatalogItem {
  sku: string;
  name: string;
  brand: Brand;
  category: string;
  tempClass: TempClass;
  packLabel: string;
  unitWeightKg: number;
  unitVolumeM3: number;
  unitValueLkr: number | null;
  fragile: boolean;
  isAdjustment: boolean;
}

type Row = [
  category: string,
  name: string,
  pack: string,
  kg: number,
  m3: number,
  lkr?: number,
  fragile?: boolean,
];

const build = (
  brand: Brand,
  tempClass: TempClass,
  prefix: string,
  first: number,
  rows: Row[],
): CatalogItem[] =>
  rows.map(
    (
      [
        category,
        name,
        packLabel,
        unitWeightKg,
        unitVolumeM3,
        unitValueLkr,
        fragile,
      ],
      i,
    ) => ({
      sku: `${prefix}-${first + i}`,
      name,
      brand,
      category,
      tempClass,
      packLabel,
      unitWeightKg,
      unitVolumeM3,
      unitValueLkr: unitValueLkr ?? null,
      fragile: fragile ?? false,
      isAdjustment: false,
    }),
  );

const FRESH_DRY: Row[] = [
  ['Staples', 'Basmati rice 5 kg', 'Bag ×4', 20, 0.03],
  ['Staples', 'Samba rice 5 kg', 'Bag ×4', 20, 0.03],
  ['Staples', 'Red raw rice 5 kg', 'Bag ×4', 20, 0.03],
  ['Staples', 'Wheat flour 1 kg', 'Bale ×10', 10, 0.015],
  ['Staples', 'Red dhal 1 kg', 'Bale ×10', 10, 0.014],
  ['Staples', 'White sugar 1 kg', 'Bale ×10', 10, 0.013],
  ['Staples', 'Brown sugar 1 kg', 'Bale ×10', 10, 0.013],
  ['Staples', 'Table salt 1 kg', 'Bale ×12', 12, 0.012],
  ['Staples', 'Coconut oil 1 L', 'Case ×12', 11.5, 0.016],
  ['Staples', 'Vegetable oil 1 L', 'Case ×12', 11.2, 0.016],
  ['Staples', 'Soya meat 90 g', 'Case ×24', 2.4, 0.02],
  ['Staples', 'Pasta 400 g', 'Case ×20', 8, 0.02],
  ['Beverages', 'Ceylon tea 400 g', 'Case ×24', 10, 0.03],
  ['Beverages', 'Instant coffee 100 g', 'Case ×12', 1.5, 0.01],
  ['Beverages', 'Milk powder 400 g', 'Case ×24', 10, 0.025],
  ['Beverages', 'Malted drink 400 g', 'Case ×12', 5, 0.015],
  ['Beverages', 'Bottled water 1.5 L', 'Pack ×12', 18.5, 0.03],
  ['Beverages', 'Ginger beer 1.5 L', 'Pack ×6', 9.5, 0.015],
  ['Snacks', 'Cream crackers 500 g', 'Case ×12', 6.5, 0.03],
  ['Snacks', 'Chocolate biscuits 200 g', 'Case ×24', 5.2, 0.025],
  ['Snacks', 'Murukku 200 g', 'Case ×20', 4.2, 0.03],
  ['Snacks', 'Cashew nuts 200 g', 'Case ×20', 4.2, 0.012],
  ['Produce', 'Red onions 10 kg', 'Sack', 10, 0.02],
  ['Produce', 'Potatoes 10 kg', 'Sack', 10, 0.018],
  ['Produce', 'Ambul bananas', 'Crate', 12, 0.04],
  ['Produce', 'Coconuts', 'Sack ×20', 14, 0.05],
  ['Household', 'Dish wash liquid 500 ml', 'Case ×12', 6.5, 0.012],
  ['Household', 'Laundry powder 1 kg', 'Bale ×10', 10.5, 0.02],
  ['Household', 'Toilet paper 10 rolls', 'Bale ×4', 4, 0.06],
  ['Household', 'Bath soap 100 g', 'Case ×48', 5, 0.008],
  ['Canned', 'Mackerel 425 g', 'Case ×24', 10.5, 0.013],
  ['Canned', 'Baked beans 420 g', 'Case ×24', 10.3, 0.013],
];

const FRESH_CHILLED: Row[] = [
  ['Dairy', 'Fresh milk 1 L', 'Crate ×12', 12.5, 0.018],
  ['Dairy', 'Set yoghurt 80 g', 'Tray ×24', 2.4, 0.01],
  ['Dairy', 'Buffalo curd 1 L', 'Crate ×6', 6.5, 0.012],
  ['Dairy', 'Butter 200 g', 'Case ×20', 4, 0.006],
  ['Dairy', 'Cheddar cheese 200 g', 'Case ×20', 4, 0.006],
  ['Dairy', 'Cheese slices 200 g', 'Case ×20', 4, 0.006],
  ['Dairy', 'Margarine 250 g', 'Case ×24', 6, 0.009],
  ['Frozen', 'Vanilla ice cream 1 L', 'Case ×6', 3.5, 0.012],
  ['Meat', 'Whole chicken', 'Crate ×6', 9, 0.02],
  ['Meat', 'Chicken breast 1 kg', 'Crate ×10', 10, 0.016],
  ['Meat', 'Chicken sausages 500 g', 'Case ×20', 10, 0.015],
  ['Meat', 'Beef cubes 1 kg', 'Crate ×10', 10, 0.016],
  ['Meat', 'Pork chops 1 kg', 'Crate ×10', 10, 0.016],
  ['Fish', 'Seer fish 1 kg', 'Box ×10', 10, 0.02],
  ['Fish', 'Prawns 500 g', 'Box ×10', 5, 0.01],
  ['Produce', 'Leafy greens', 'Crate', 4, 0.02],
  ['Produce', 'Carrots 5 kg', 'Crate', 5, 0.012],
  ['Beverages', 'Orange juice 1 L', 'Case ×12', 12.5, 0.018],
];

const STYLE: Row[] = [
  ['Menswear', 'Cotton T-shirt', 'Carton ×24', 6, 0.04],
  ['Menswear', 'Polo shirt', 'Carton ×20', 6, 0.04],
  ['Menswear', 'Formal shirt', 'Carton ×20', 6.5, 0.045],
  ['Menswear', 'Denim jeans', 'Carton ×12', 9, 0.05],
  ['Menswear', 'Chinos', 'Carton ×12', 7.5, 0.045],
  ['Menswear', 'Sarong', 'Carton ×24', 7, 0.04],
  ['Womenswear', 'Day dress', 'Carton ×12', 5, 0.04],
  ['Womenswear', 'Skirt', 'Carton ×20', 5.5, 0.04],
  ['Womenswear', 'Saree', 'Carton ×10', 6, 0.04],
  ['Womenswear', 'Blouse', 'Carton ×20', 4.5, 0.035],
  ['Womenswear', 'Shorts', 'Carton ×24', 5, 0.035],
  ['Kids', 'Kids T-shirt', 'Carton ×30', 4.5, 0.035],
  ['Kids', 'School shoes', 'Carton ×12', 9, 0.06],
  ['Outerwear', 'Hoodie', 'Carton ×10', 7, 0.06],
  ['Basics', 'Socks 3-pack', 'Carton ×40', 4, 0.025],
  ['Basics', 'Underwear 3-pack', 'Carton ×40', 4.5, 0.025],
  ['Accessories', 'Cap', 'Carton ×30', 3, 0.05],
  ['Accessories', 'Leather belt', 'Carton ×24', 5, 0.02],
  ['Accessories', 'Handbag', 'Carton ×10', 6, 0.07],
  ['Footwear', 'Sneakers', 'Carton ×10', 9, 0.07],
];

const TECH: Row[] = [
  ['Phones', 'Smartphone', 'Carton ×10', 3.5, 0.02, 650_000, true],
  ['Phones', 'Feature phone', 'Carton ×20', 3, 0.015, 140_000, true],
  ['Audio', 'Wireless earbuds', 'Carton ×20', 2.5, 0.015, 240_000, true],
  ['Audio', 'Bluetooth speaker', 'Carton ×10', 6, 0.03, 180_000, true],
  ['Power', 'Power bank 10,000 mAh', 'Carton ×20', 5, 0.015, 160_000],
  ['Power', 'USB charger', 'Carton ×40', 3, 0.015, 120_000],
  ['Power', 'Charging cable', 'Carton ×50', 2.5, 0.012, 75_000],
  ['Wearables', 'Smart watch', 'Carton ×10', 1.5, 0.008, 300_000, true],
  ['Computing', 'Tablet', 'Carton ×6', 4, 0.025, 540_000, true],
  ['Computing', 'Laptop', 'Carton ×4', 10, 0.05, 1_600_000, true],
  ['Computing', 'Wi-Fi router', 'Carton ×10', 6, 0.04, 150_000],
  ['Computing', 'Keyboard and mouse set', 'Carton ×10', 7, 0.05, 90_000],
  ['Storage', 'Memory card 64 GB', 'Carton ×50', 1, 0.004, 125_000],
  ['Storage', 'USB flash drive 64 GB', 'Carton ×50', 1, 0.004, 110_000],
  ['Home', 'LED bulb 4-pack', 'Carton ×20', 4, 0.03, 50_000, true],
];

/** The line that carries what is left of a seeded order's totals (one per brand and class). */
const ADJUSTMENTS: CatalogItem[] = (
  [
    ['FR-9000', 'FRESH', 'AMBIENT', 'Mixed dry cases'],
    ['FR-9001', 'FRESH', 'CHILLED', 'Mixed chilled cases'],
    ['ST-9000', 'STYLE', 'AMBIENT', 'Mixed apparel cartons'],
    ['TE-9000', 'TECH', 'AMBIENT', 'Mixed tech cartons'],
  ] as const
).map(([sku, brand, tempClass, name]) => ({
  sku,
  name,
  brand,
  category: 'Mixed',
  tempClass,
  packLabel: 'Mixed',
  unitWeightKg: 1,
  unitVolumeM3: 0.001,
  unitValueLkr: null,
  fragile: false,
  isAdjustment: true,
}));

/**
 * The item catalog: Fresh 50 (32 dry, 18 chilled), Style 20 and Tech 15, plus one adjustment
 * item per brand and class. Invented, deterministic and the same on every run.
 */
export const CATALOG: readonly CatalogItem[] = [
  ...build('FRESH', 'AMBIENT', 'FR', 1001, FRESH_DRY),
  ...build('FRESH', 'CHILLED', 'FR', 2001, FRESH_CHILLED),
  ...build('STYLE', 'AMBIENT', 'ST', 3001, STYLE),
  ...build('TECH', 'AMBIENT', 'TE', 4001, TECH),
  ...ADJUSTMENTS,
];

/** What a store can order for a brand and class (adjustment items are not on the shelf). */
export const catalogFor = (brand: Brand, tempClass: TempClass): CatalogItem[] =>
  CATALOG.filter(
    (i) => i.brand === brand && i.tempClass === tempClass && !i.isAdjustment,
  );

export const adjustmentFor = (
  brand: Brand,
  tempClass: TempClass,
): CatalogItem => {
  const found = CATALOG.find(
    (i) => i.isAdjustment && i.brand === brand && i.tempClass === tempClass,
  );
  if (!found)
    throw new Error(`[seed] no adjustment item for ${brand} ${tempClass}`);
  return found;
};

/**
 * Upserts the catalog by SKU. Adjustment items are inactive, so M1 and M9 never offer them; they
 * exist only to make a seeded order's lines add up.
 */
export async function seedCatalog(db: DbLike): Promise<number> {
  await db
    .insert(items)
    .values(CATALOG.map((i) => ({ ...i, active: !i.isAdjustment })))
    .onConflictDoUpdate({
      target: items.sku,
      set: {
        name: sql.raw('excluded."name"'),
        brand: sql.raw('excluded."brand"'),
        category: sql.raw('excluded."category"'),
        tempClass: sql.raw('excluded."tempClass"'),
        packLabel: sql.raw('excluded."packLabel"'),
        unitWeightKg: sql.raw('excluded."unitWeightKg"'),
        unitVolumeM3: sql.raw('excluded."unitVolumeM3"'),
        unitValueLkr: sql.raw('excluded."unitValueLkr"'),
        fragile: sql.raw('excluded."fragile"'),
        isAdjustment: sql.raw('excluded."isAdjustment"'),
        active: sql.raw('excluded."active"'),
      },
    });
  return CATALOG.length;
}
