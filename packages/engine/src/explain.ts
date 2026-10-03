import { BRANDS, TEMP_CLASSES, type Brand, type TempClass } from '@waypoint/shared/domain';
import { allocContext, districtOf, orderOf, type AllocContext } from './allocate/context';
import { vehicleKindFor } from './allocate/reasons';
import { RESOURCE_LABELS } from './allocate/stats';
import { vehicleOf } from './allocate/fits';
import { DEFERRAL_REASONS } from './rules/reason-map';
import type { DeferralCost, EngineInput, EngineOutput, PlanStats, ResourceUse, Unplanned } from './types';
import { stableSort } from './util/stable-sort';

/**
 * The plan in sentences, from fixed templates and the numbers the plan already carries. It works
 * nothing out and invents nothing: the AI panel only rephrases these and falls back to them.
 */
export interface PlanExplanation {
  /** The headline: what held the plan back, and what waits because of it. */
  plan: string;
  /** One line per scarce resource the fleet has any of. */
  resources: readonly string[];
  /** What the deferrals cost, split into the unavoidable and the chosen. */
  deferrals: readonly string[];
  unplanned: readonly { orderId: string; ref: string; sentence: string }[];
}

const BRAND_WORDS: Readonly<Record<Brand, string>> = { FRESH: 'Fresh', STYLE: 'Style', TECH: 'Tech' };
const CLASS_WORDS: Readonly<Record<TempClass, string>> = { AMBIENT: 'ambient', CHILLED: 'chilled' };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function costPhrase(cost: DeferralCost): string {
  return `${plural(cost.units, 'unit', 'units')}, ${cost.volumeM3} m³, ${plural(cost.outlets, 'outlet', 'outlets')}`;
}

/** The biggest group of orders left waiting, so the headline names what actually waits. */
function cohortOf(ctx: AllocContext, unplanned: readonly Unplanned[]) {
  const cohorts = TEMP_CLASSES.flatMap((tempClass) =>
    BRANDS.map((brand) => {
      const members = unplanned.filter((u) => {
        const order = orderOf(ctx, u.orderId);
        return order.brand === brand && order.tempClass === tempClass;
      });
      return { brand, tempClass, members };
    }),
  );
  const ordered = stableSort(cohorts, (a, b) => b.members.length - a.members.length);
  return ordered[0];
}

function cohortSentence(ctx: AllocContext, unplanned: readonly Unplanned[]): string {
  const cohort = cohortOf(ctx, unplanned);
  if (!cohort || cohort.members.length === 0) return '';
  const unavoidable = cohort.members.filter((u) => u.choice === 'UNAVOIDABLE').length;
  const chosen = cohort.members.filter((u) => u.choice === 'PRIORITY_CHOICE').length;
  const what = `${CLASS_WORDS[cohort.tempClass]} ${BRAND_WORDS[cohort.brand]}`;
  const orders = plural(cohort.members.length, `${what} order`, `${what} orders`);
  const wait = cohort.members.length === 1 ? 'waits' : 'wait';
  return `${orders} ${wait}; ${unavoidable} ${
    unavoidable === 1 ? 'was' : 'were'
  } unavoidable and ${chosen} made room for outlets skipped yesterday.`;
}

function limitPhrase(resource: ResourceUse): string {
  const { label, tripWord } = RESOURCE_LABELS[resource.resource];
  if (resource.trips === 0) return `${label} was the limit: ${resource.pct}% of the ${resource.measure} is gone.`;
  return `${label} was the limit: ${resource.fullTrips} of ${resource.trips} ${tripWord} trips are full (${resource.pct}% of ${resource.measure}).`;
}

function planSentence(ctx: AllocContext, stats: PlanStats, unplanned: readonly Unplanned[]): string {
  if (unplanned.length === 0) {
    return `Every order is planned: ${plural(stats.served, 'order', 'orders')} on ${plural(stats.trips, 'trip', 'trips')}.`;
  }
  const cohort = cohortSentence(ctx, unplanned);
  const limiting = stats.limiting[0];
  if (limiting) return `${limitPhrase(limiting)} ${cohort}`;
  const closest = stableSort(
    stats.resources.filter((r) => r.total > 0),
    (a, b) => b.pct - a.pct,
  )[0];
  if (!closest) return `No resource was the limit. ${cohort}`;
  const { label } = RESOURCE_LABELS[closest.resource];
  return `No single resource was the limit; ${label.toLowerCase()} came closest at ${closest.pct}% of ${closest.measure}. ${cohort}`;
}

function resourceLine(resource: ResourceUse): string {
  const { label, tripWord } = RESOURCE_LABELS[resource.resource];
  const head = `${label}: ${resource.used} of ${resource.total} ${resource.unit} used (${resource.pct}%)`;
  if (resource.trips === 0) return `${head}.`;
  return `${head}; ${resource.fullTrips} of ${resource.trips} ${tripWord} trips are full.`;
}

function deferralLines(stats: PlanStats): string[] {
  const lines: string[] = [];
  if (stats.unavoidable.orders > 0) {
    lines.push(
      `${plural(stats.unavoidable.orders, 'deferral was', 'deferrals were')} unavoidable: ${costPhrase(stats.unavoidable)}.`,
    );
  }
  if (stats.chosen.orders > 0) {
    lines.push(
      `${plural(stats.chosen.orders, 'deferral', 'deferrals')} made room for a higher-priority order: ${costPhrase(stats.chosen)}.`,
    );
  }
  if (stats.repeatSkipsAvoided > 0) {
    lines.push(
      `${plural(stats.repeatSkipsAvoided, 'order', 'orders')} for outlets deferred on their last run ${
        stats.repeatSkipsAvoided === 1 ? 'is' : 'are'
      } served today.`,
    );
  }
  if (stats.repeatSkipsIncurred > 0) {
    lines.push(
      `${plural(stats.repeatSkipsIncurred, 'outlet is', 'outlets are')} deferred for a second run in a row and ${
        stats.repeatSkipsIncurred === 1 ? 'needs' : 'need'
      } a written note.`,
    );
  }
  return lines;
}

/**
 * Why one order waits, in the words screen 15 uses: what it needed, the most room any trip that could
 * have taken it had left, and the vehicles that were tried. Screen M4 shows the store the reason map's
 * wording instead, never these numbers.
 */
export function explainUnplanned(input: EngineInput, unplanned: Unplanned): string {
  const ctx = allocContext(input);
  const order = orderOf(ctx, unplanned.orderId);
  const detail = unplanned.detail;
  const label = DEFERRAL_REASONS.find((reason) => reason.code === unplanned.reasonCode)?.label;
  if (!detail) return `${order.ref} waits: ${label ?? unplanned.reasonCode}.`;

  const district = districtOf(ctx, order.districtId);
  const where = `${district.name ?? district.id} ${vehicleKindFor(ctx, order)}`;
  const needs = `it needs ${detail.needVolumeM3} m³ ${CLASS_WORDS[order.tempClass]}`;
  const room =
    detail.bestVolumeM3 === null || detail.bestVehicleId === null
      ? `no ${where} trip could take it`
      : `the most space left on any ${where} trip is ${detail.bestVolumeM3} m³ (${
          vehicleOf(ctx, detail.bestVehicleId).code
        } trip ${detail.bestTripNo})`;
  const tried = unplanned.tried ?? [];
  const codes = tried.map((entry) => vehicleOf(ctx, entry.vehicleId).code).join(', ');
  const trail = codes === '' ? '' : ` Tried ${codes}.`;
  return `${order.ref} waits: ${needs}, and ${room}.${trail}`;
}

/** Every sentence for a finished plan: the headline, the resources, the deferrals and each order. */
export function explain(input: EngineInput, output: EngineOutput): PlanExplanation {
  const ctx = allocContext(input);
  return {
    plan: planSentence(ctx, output.stats, output.unplanned),
    resources: output.stats.resources.filter((r) => r.total > 0).map(resourceLine),
    deferrals: deferralLines(output.stats),
    unplanned: output.unplanned.map((unplanned) => ({
      orderId: unplanned.orderId,
      ref: orderOf(ctx, unplanned.orderId).ref,
      sentence: explainUnplanned(input, unplanned),
    })),
  };
}
