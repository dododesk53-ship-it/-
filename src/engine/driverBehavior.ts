import type { DriverState, GameState } from './types';
import { clamp, round1 } from './util';

/** 队友关系由当前信任、心态与自尊推算，因此不需要新增存档字段。 */
export function teammateRelationship(state: GameState, teamId: string): number {
  const drivers = Object.values(state.drivers).filter(driver => driver.teamId === teamId && driver.role === 'race');
  if (drivers.length < 2) return 100;
  const [a, b] = drivers;
  const trust = (a.trust + b.trust) / 2;
  const egoPressure = (a.ego + b.ego) / 10;
  const moraleGap = Math.abs(a.morale - b.morale) * 0.2;
  return round1(clamp(trust + 20 - egoPressure - moraleGap, 0, 100));
}

/** 只有信任低于 40 或队友关系低于 50 时，才会出现策略抗命。 */
export function strategyDisobedienceChance(driver: DriverState, relationship: number): number {
  if (driver.trust >= 40 && relationship >= 50) return 0;
  const trustRisk = Math.max(0, 40 - driver.trust) / 40;
  const relationshipRisk = Math.max(0, 50 - relationship) / 50;
  return clamp(0.12 + trustRisk * 0.48 + relationshipRisk * 0.4 + driver.ego / 500, 0.12, 0.9);
}
