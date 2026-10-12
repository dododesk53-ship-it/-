import { describe, expect, it } from 'vitest';
import { dispatch } from '../../src/engine/actions';
import { openMarket, previewContractOffer } from '../../src/engine/market';
import { buildView } from '../../src/engine/view';
import { newTestGame } from '../helpers';

describe('确定性合同市场', () => {
  it('报价是纯函数，薪资提高不会降低接受分', () => {
    const state = newTestGame();
    const window = openMarket(state, state.season.year + 1);
    const driver = state.teams.team_c.cars[0].driverId!;
    const terms = { windowId: window.id, marketRevision: state.market!.revision, personId: driver, annualSalary: 10, years: 2, role: 'race' as const, slot: 1 };
    const before = JSON.stringify(state);
    const low = previewContractOffer(state, 'team_c', terms, 'driver');
    const high = previewContractOffer(state, 'team_c', { ...terms, annualSalary: 20 }, 'driver');
    expect(JSON.stringify(state)).toBe(before);
    expect(high.score).toBeGreaterThanOrEqual(low.score);
    expect(low.windowId).toBe(window.id);
  });

  it('accepted offer locks a candidate and rejects stale submissions', () => {
    const state = newTestGame();
    const window = openMarket(state, state.season.year + 1);
    const driver = state.teams.team_c.cars[0].driverId!;
    const action = { type: 'OFFER_DRIVER_CONTRACT' as const, windowId: window.id, marketRevision: state.market!.revision, driverId: driver, annualSalary: 50, years: 2, role: 'race' as const, slot: 1 };
    const accepted = dispatch(state, action);
    expect(accepted.ok).toBe(true);
    expect(accepted.state.market!.window!.agreements).toHaveLength(1);
    const stale = dispatch(accepted.state, action);
    expect(stale.ok).toBe(false);
    expect(stale.state).toBe(accepted.state);
  });

  it('exposes public projected roster and all five staff roles without rival finance', () => {
    const state = newTestGame();
    const view = buildView(state);
    expect(view.market.window?.targetYear).toBe(state.season.year);
    expect(Object.keys(view.market.current!.staff)).toHaveLength(5);
    expect(JSON.stringify(view.market)).not.toContain('costCapSpent');
    expect(JSON.stringify(view.market)).not.toContain('funds');
  });
});
