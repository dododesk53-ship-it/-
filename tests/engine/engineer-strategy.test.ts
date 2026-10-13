import { describe, expect, it } from 'vitest';
import { act, advanceUntil, newTestGame } from '../helpers';
import { engineerDecisionRoll, engineerWeatherRisk } from '../../src/engine/race';

describe('engineer strategy execution', () => {
  it('uses the requested team-specific wet-weather risks and tyre preferences', () => {
    expect(engineerWeatherRisk('ferrari', '法拉利', .3)).toMatchObject({ probability: .55, preference: 'soft' });
    expect(engineerWeatherRisk('mclaren', '迈凯伦', .7)).toMatchObject({ probability: .25, preference: 'medium' });
    expect(engineerWeatherRisk('aston_martin', '阿斯顿·马丁', .4)).toMatchObject({ probability: .3, preference: 'medium' });
    expect(engineerWeatherRisk('racing_bulls', '小红牛', .03)).toMatchObject({ probability: .8, preference: 'intermediate' });
    expect(engineerWeatherRisk('racing_bulls', '小红牛', .2)).toMatchObject({ probability: .8, preference: 'intermediate' });
    expect(engineerWeatherRisk('racing_bulls', '小红牛', .029)).toBeNull();
    expect(engineerWeatherRisk('racing_bulls', '小红牛', .201)).toBeNull();
  });

  it('makes each weather decision deterministic without using a supplied race RNG', () => {
    const session = { id: 'race-test' };
    const car = { driverId: 'driver-test' };
    const first = engineerDecisionRoll(session, car, 'wet-dry-tyre', .55);
    for (let i = 0; i < 10; i++) expect(engineerDecisionRoll(session, car, 'wet-dry-tyre', .55)).toBe(first);
  });

  it('skips player decision windows when both drivers listen to engineers', () => {
    let state = advanceUntil(newTestGame(7190), current => current.season.phase === 'race');
    const driverIds = Object.values(state.drivers).filter(driver => driver.teamId === state.meta.playerTeamId).map(driver => driver.id);
    for (const driverId of driverIds) state = act(state, { type: 'SET_PLAN', driverId, plan: { strategySource: 'engineer' } });
    state = act(state, { type: 'START_RACE', kind: 'race' });
    expect(state.weekend!.liveRace!.pendingDecision).toBeNull();
    const live = state.weekend!.liveRace!;
    state = act(state, { type: 'ADVANCE_RACE', sessionId: live.id, expectedRevision: live.revision, until: 'next_lap' });
    expect(state.weekend!.liveRace!.completedLaps).toBe(1);
  });
});
