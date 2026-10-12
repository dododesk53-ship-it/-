import { STAFF_ROLES } from './defaults';
import { offerDriverContract, offerStaffContract, ensureMarket, type MarketOutcome } from './market';
import type { GameState, StaffRole } from './types';

/**
 * Deliberately small deterministic AI pass. It only uses the same public quote/offer
 * path as the player; processing order is persisted public strength then team id.
 */
export function resolveAiMarket(state: GameState, playerTeamId = state.meta.playerTeamId): MarketOutcome {
  const market = ensureMarket(state);
  const window = market.window;
  if (!window || window.status === 'closed') return { ok: false, message: '合同市场尚未开放' };
  if (window.aiResolved) return { ok: true, message: '其他车队的市场已处理' };
  const order = Object.keys(state.teams)
    .filter(id => id !== playerTeamId)
    .sort((a, b) => (window.strengthByTeam[b] - window.strengthByTeam[a]) || a.localeCompare(b));
  for (const teamId of order) {
    const team = state.teams[teamId];
    const roster = window.projectedRosters[teamId];
    // Retain/re-sign the team’s own active race drivers first. This cannot poach a
    // player contract and produces a stable valid grid even in minimal custom data.
    for (const car of team.cars) {
      if (roster.raceSeats[String(car.slot)]) continue;
      const incumbent = car.driverId ? state.drivers[car.driverId] : undefined;
      const available = Object.values(state.drivers)
        .filter(d => !window.agreements.some(a => a.personId === d.id))
        .filter(d => d.teamId !== playerTeamId || d.contractEnd < window.targetYear)
        .sort((a, b) => a.id.localeCompare(b.id));
      const candidate = incumbent?.teamId === teamId && !window.agreements.some(a => a.personId === incumbent.id) ? incumbent : available[0];
      if (!candidate) continue;
      const profile = window.candidateProfiles[candidate.id];
      const salary = Math.round(Math.max(candidate.salary || 0.5, profile?.askingSalary ?? 0.5) * 130) / 100;
      offerDriverContract(state, teamId, { windowId: window.id, marketRevision: market.revision, personId: candidate.id, annualSalary: salary, years: Math.max(1, profile?.preferredYears ?? 1), role: 'race', slot: car.slot });
    }
    for (const role of STAFF_ROLES) {
      if (roster.staff[role]) continue;
      const incumbent = team.staff[role];
      const candidate = incumbent?.id && !window.agreements.some(a => a.personId === incumbent.id)
        ? incumbent
        : Object.values(market.freeStaff).filter(s => s.role === role && !window.agreements.some(a => a.personId === s.id)).sort((a, b) => (a.id ?? '').localeCompare(b.id ?? ''))[0];
      if (!candidate?.id) continue;
      const profile = window.candidateProfiles[candidate.id];
      const salary = Math.round(Math.max(candidate.salary || 0.3, profile?.askingSalary ?? 0.3) * 130) / 100;
      offerStaffContract(state, teamId, { windowId: window.id, marketRevision: market.revision, personId: candidate.id, annualSalary: salary, years: Math.max(1, profile?.preferredYears ?? 1) }, role as StaffRole);
    }
  }
  window.aiResolved = true;
  window.status = 'ai_resolved';
  market.revision++;
  return { ok: true, message: '其他车队的合同市场已按公开规则处理完成' };
}
