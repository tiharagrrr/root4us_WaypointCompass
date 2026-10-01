import type { ItemDto } from '@compass/api-client'

/**
 * The hand-built world behind the store screens while the Ordering endpoints are stubs: one Fresh
 * outlet, its range, and the two orders of the day. None of it is competition data: the item
 * names and quantities are the ones the M1, M1a and M1b frames show, with the column rules from
 * specs/data/datasets.md and the house style from the test-fixtures skill.
 */

export const OUTLET = { id: 'OUT014', name: 'Fresh Kadawatha' }
export const DELIVERY_WINDOW = { openMin: 420, open: '07:00', closeMin: 540, close: '09:00' }

export interface DemoItem extends Omit<ItemDto, '_links'> {
  /** Packs the day's order starts with, when this item is one of its lines. */
  startQty?: number
}

const item = (
  id: string,
  sku: string,
  name: string,
  category: string,
  tempClass: 'AMBIENT' | 'CHILLED',
  packLabel: string,
  unitWeightKg: number,
  unitVolumeM3: number,
  startQty?: number,
): DemoItem => ({
  id,
  sku,
  name,
  brand: 'FRESH',
  category,
  tempClass,
  packLabel,
  unitWeightKg,
  unitVolumeM3,
  unitValueLkr: null,
  fragile: false,
  active: true,
  startQty,
})

/** The Fresh range this outlet orders from: 12 ambient items and 6 chilled. */
export const ITEMS: DemoItem[] = [
  item('0192b001-0000-7000-8000-000000000001', 'FR-1102', 'Basmati rice 5 kg', 'Grains', 'AMBIENT', 'Bag ×4', 20, 0.03, 12),
  item('0192b001-0000-7000-8000-000000000002', 'FR-1150', 'Red lentils 1 kg', 'Grains', 'AMBIENT', 'Case ×10', 10, 0.02, 6),
  item('0192b001-0000-7000-8000-000000000003', 'FR-1162', 'Chickpeas 1 kg', 'Grains', 'AMBIENT', 'Case ×10', 10, 0.02),
  item('0192b001-0000-7000-8000-000000000004', 'FR-1170', 'Sugar 1 kg', 'Grains', 'AMBIENT', 'Case ×10', 10, 0.02),
  item('0192b001-0000-7000-8000-000000000005', 'FR-2210', 'Coconut oil 1 L', 'Oils', 'AMBIENT', 'Case ×12', 13, 0.03, 8),
  item('0192b001-0000-7000-8000-000000000006', 'FR-2215', 'Sunflower oil 1 L', 'Oils', 'AMBIENT', 'Case ×12', 11, 0.03),
  item('0192b001-0000-7000-8000-000000000007', 'FR-3301', 'Ceylon tea 400 g', 'Tea & drinks', 'AMBIENT', 'Case ×24', 10, 0.04, 4),
  item('0192b001-0000-7000-8000-000000000008', 'FR-3310', 'Green tea 100 g', 'Tea & drinks', 'AMBIENT', 'Case ×24', 2.4, 0.02),
  item('0192b001-0000-7000-8000-000000000009', 'FR-3120', 'Milk powder 400 g', 'Tea & drinks', 'AMBIENT', 'Case ×24', 9.6, 0.03),
  item('0192b001-0000-7000-8000-00000000000a', 'FR-1120', 'Wheat flour 1 kg', 'Baking', 'AMBIENT', 'Case ×10', 10, 0.02, 10),
  item('0192b001-0000-7000-8000-00000000000b', 'FR-4110', 'Baking powder 100 g', 'Baking', 'AMBIENT', 'Case ×24', 2.4, 0.01),
  item('0192b001-0000-7000-8000-00000000000c', 'FR-4120', 'Vanilla essence 50 ml', 'Baking', 'AMBIENT', 'Case ×24', 1.2, 0.01),
  item('0192b002-0000-7000-8000-000000000001', 'FR-5010', 'Fresh milk 1 L', 'Dairy', 'CHILLED', 'Crate ×12', 13, 0.03, 14),
  item('0192b002-0000-7000-8000-000000000002', 'FR-5102', 'Set yoghurt 80 g', 'Dairy', 'CHILLED', 'Tray ×24', 2.2, 0.01, 10),
  item('0192b002-0000-7000-8000-000000000003', 'FR-5120', 'Cheddar block 250 g', 'Dairy', 'CHILLED', 'Case ×20', 5, 0.02),
  item('0192b002-0000-7000-8000-000000000004', 'FR-6201', 'Chicken breast 1 kg', 'Meat', 'CHILLED', 'Box ×8', 8.33, 0.02, 6),
  item('0192b002-0000-7000-8000-000000000005', 'FR-6210', 'Minced beef 500 g', 'Meat', 'CHILLED', 'Box ×10', 5, 0.02),
  item('0192b002-0000-7000-8000-000000000006', 'FR-7101', 'Green beans 500 g', 'Produce', 'CHILLED', 'Crate ×20', 10, 0.04),
]
