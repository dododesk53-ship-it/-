import { describe, expect, it } from 'vitest';
import { normalizeDatabase } from '../../src/engine/data';
import { createGame } from '../../src/engine/newgame';
import { carRatings } from '../../src/engine/ratings';
import type { Database } from '../../src/engine/types';
import { advanceUntil, cardSources } from '../helpers';

/** 角色卡实际携带的 2026 真实车队与车手数据 */
function cardDb(): Database {
  const res = normalizeDatabase(cardSources());
  expect(res.issues).toEqual([]);
  expect(res.canStart).toBe(true);
  return res.db!;
}

const PU_SUPPLIERS: Record<string, string[]> = {
  mercedes: ['mclaren', 'williams', 'alpine'],
  red_bull: ['racing_bulls'],
  ferrari: ['haas', 'cadillac'],
};

describe('角色卡数据：2026 真实阵容', () => {
  it('读取时没有错误或警告', () => {
    cardDb();
  });

  it('11 支车队，每队 2 名正式车手，车号不重复', () => {
    const db = cardDb();
    expect(db.teams).toHaveLength(11);
    const race = db.drivers.filter(d => d.role === 'race');
    expect(race).toHaveLength(22);
    for (const t of db.teams) expect(race.filter(d => d.teamId === t.id)).toHaveLength(2);
    expect(new Set(db.drivers.map(d => d.number)).size).toBe(db.drivers.length);
    expect(db.drivers.every(d => d.teamId === null || db.teams.some(t => t.id === d.teamId))).toBe(true);
  });

  it('法拉利保留特殊机制与两位车手', () => {
    const db = cardDb();
    expect(db.teams.find(t => t.id === 'ferrari')!.special).toBe('ferrari');
    for (const id of ['hamilton', 'leclerc']) {
      const d = db.drivers.find(x => x.id === id)!;
      expect(d.teamId).toBe('ferrari');
      expect(d.role).toBe('race');
    }
  });

  it('同一供应商的客户车队使用同一规格的动力单元', () => {
    const db = cardDb();
    const team = (id: string) => db.teams.find(t => t.id === id)!;
    for (const [works, customers] of Object.entries(PU_SUPPLIERS)) {
      for (const c of customers) {
        expect(team(c).parts.power_unit, `${c} 内燃机`).toEqual(team(works).parts.power_unit);
        expect(team(c).parts.ers, `${c} 能量回收系统`).toEqual(team(works).parts.ers);
      }
    }
  });

  it('赛车性能符合季前格局', () => {
    const state = createGame(cardDb(), { playerTeamId: 'ferrari', principalName: '测试', seed: 1, gameId: 'g', now: 1 });
    const r = (id: string) => carRatings(state.teams[id], state.teams[id].cars[0], state.rules);
    const overall = Object.keys(state.teams).sort((a, b) => r(b).overall - r(a).overall);
    expect(overall[0]).toBe('mercedes');
    expect(overall.at(-1)).toBe('cadillac');
    expect(overall.slice(0, 3).sort()).toEqual(['mclaren', 'mercedes', 'red_bull']);
    // 本卡设定：法拉利动力单元失败，动力属性低于梅赛德斯与红牛-福特动力的车队
    expect(r('ferrari').power).toBeLessThan(r('williams').power);
    expect(r('ferrari').downforce).toBeGreaterThan(r('williams').downforce);
    // 阿斯顿·马丁-本田可靠性全场最差
    const rel = Object.keys(state.teams).sort((a, b) => r(a).reliability - r(b).reliability);
    expect(rel[0]).toBe('aston_martin');
  });

  it.each(['mercedes', 'ferrari', 'cadillac'])('以 %s 开局可以跑完第一站', teamId => {
    const s = advanceUntil(
      createGame(cardDb(), { playerTeamId: teamId, principalName: '测试', seed: 7, gameId: 'g', now: 1 }),
      x => x.season.phase === 'post_race',
    );
    expect(Object.values(s.standings.drivers).reduce((a, d) => a + d.points, 0)).toBeGreaterThan(0);
  });
});
