import { describe, expect, it } from 'vitest';
import { normalizeDatabase } from '../../src/engine/data';
import { placeholderSources } from '../helpers';

describe('数据解析（世界书 YAML）', () => {
  it('占位测试数据可以无错误加载', () => {
    const res = normalizeDatabase(placeholderSources());
    const errors = res.issues.filter(i => i.level === 'error');
    expect(errors).toEqual([]);
    expect(res.canStart).toBe(true);
    expect(res.db!.teams).toHaveLength(4);
    expect(res.db!.drivers).toHaveLength(9);
    expect(res.db!.tracks).toHaveLength(3);
    expect(res.db!.calendar).toHaveLength(3);
    expect(res.db!.calendar[1].sprint).toBe(true);
    // 赛道权重自动归一化
    for (const t of res.db!.tracks) {
      const s = Object.values(t.weights).reduce((a, b) => a + b, 0);
      expect(s).toBeCloseTo(1, 2);
    }
  });

  it('数据指纹稳定', () => {
    const a = normalizeDatabase(placeholderSources()).db!.signature;
    const b = normalizeDatabase(placeholderSources()).db!.signature;
    expect(a).toBe(b);
  });

  it('支持中文顶层键与多条目合并（同 id 后者覆盖）', () => {
    const res = normalizeDatabase([
      ...placeholderSources(),
      { name: '补丁', data: { 车队: [{ id: 'team_d', name: '改名车队D', carBase: { perf: 75, rel: 80 } }] } },
    ]);
    expect(res.db!.teams.find(t => t.id === 'team_d')!.name).toBe('改名车队D');
    expect(res.issues.some(i => i.level === 'warning' && i.message.includes('重复'))).toBe(true);
  });

  it('规则深度合并', () => {
    const res = normalizeDatabase([...placeholderSources(), { name: '规则补丁', data: { rules: { costCap: 200, parts: { power_unit: { developable: false } } } } }]);
    expect(res.db!.rules.costCap).toBe(200);
    expect(res.db!.rules.parts.power_unit.developable).toBe(false);
    expect(res.db!.rules.parts.power_unit.baseCost).toBe(6);
  });

  it('引用错误会阻止开局并给出路径', () => {
    const res = normalizeDatabase([
      {
        name: '坏数据',
        data: {
          teams: [{ id: 'x' }, { id: 'y' }],
          drivers: [
            { id: 'd1', team: 'x' },
            { id: 'd2', team: 'nope' },
          ],
          tracks: [{ id: 't1' }],
          calendar: [{ track: 't1' }, { track: 'missing' }],
        },
      },
    ]);
    expect(res.canStart).toBe(false);
    const msgs = res.issues.filter(i => i.level === 'error').map(i => `${i.path} ${i.message}`);
    expect(msgs.some(m => m.includes('nope'))).toBe(true);
    expect(msgs.some(m => m.includes('missing'))).toBe(true);
    expect(msgs.some(m => m.includes('teams.y') && m.includes('正式车手'))).toBe(true);
  });

  it('空数据给出明确错误', () => {
    const res = normalizeDatabase([]);
    expect(res.canStart).toBe(false);
    expect(res.issues.map(i => i.path)).toEqual(expect.arrayContaining(['teams', 'tracks', 'calendar']));
  });

  it('非法数值会被修正并警告', () => {
    const src = placeholderSources();
    const res = normalizeDatabase([
      ...src,
      { name: '越界', data: { drivers: [{ id: 'z1', team: 'team_d', role: 'reserve', attrs: { pace: 150, wet: 'abc' } }] } },
    ]);
    const z = res.db!.drivers.find(d => d.id === 'z1')!;
    expect(z.attrs.pace).toBe(100);
    expect(res.issues.some(i => i.message.includes('不是有效数字'))).toBe(true);
  });
});
