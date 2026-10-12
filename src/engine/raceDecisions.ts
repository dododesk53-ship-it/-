import type { Compound, EnergyMode, PaceMode, PitTiming, TeamOrders } from './types';

export const PACE_MODES: PaceMode[] = ['conserve', 'balanced', 'push'];
export const ENERGY_MODES: EnergyMode[] = ['harvest', 'balanced', 'deploy'];
export const PIT_TIMINGS: PitTiming[] = ['early', 'standard', 'late'];

export function validCompound(compound: unknown, tyres: Record<string, unknown>): compound is Compound {
  return typeof compound === 'string' && !!tyres[compound];
}

export function validOrders(orders: TeamOrders | undefined, playerIds: readonly string[]): boolean {
  if (!orders) return true;
  if (!['free', 'hold', 'favor'].includes(orders.mode)) return false;
  return orders.mode !== 'favor' || (!!orders.favorDriverId && playerIds.includes(orders.favorDriverId));
}
