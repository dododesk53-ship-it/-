/**
 * 旧存档升级：补齐 2026 规则新增的字段，保证旧版本（2025 规则）的存档可以继续读取。
 *
 * - 规则：只补缺失的键（不覆盖存档里已有的值），包括新零件类型「能量回收系统」。
 * - 车队：补齐缺失的零件类型（按 70/80 的基础规格），并装到每台车上。
 * - 车手：按当前装车初始化动力单元配额计数。
 * - 法拉利：旧存档没有该字段时设为 null（不启用机制）。
 *
 * 判断依据：没有 rules.puAllocation 的存档是 2026 规则之前的存档。
 * 函数是幂等的，原地修改并返回同一个对象。
 */
import { DEFAULT_RULES } from './defaults';
import { resetPuUsage } from './powerunit';
import type { GameState } from './types';
import { deepClone } from './util';

function fillMissing(target: Record<string, unknown>, defaults: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(defaults)) {
    if (!(k in target) || target[k] === undefined) target[k] = deepClone(v);
    else if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) {
      fillMissing(target[k] as Record<string, unknown>, v as Record<string, unknown>);
    }
  }
}

export function migrateState(state: GameState): GameState {
  if (!state?.rules || !state.teams) return state;
  if (state.ferrari === undefined) state.ferrari = null;
  // 已经是 2026 规则的存档（有 puAllocation）不再补规则：玩家可能在世界书里有意删掉了某些默认项
  if (state.rules.puAllocation) return state;
  fillMissing(state.rules as unknown as Record<string, unknown>, DEFAULT_RULES as unknown as Record<string, unknown>);

  for (const team of Object.values(state.teams)) {
    for (const pt of Object.keys(state.rules.parts)) {
      if (!team.parts[pt]) {
        const id = `${pt}-S${state.season?.number ?? 1}m`;
        team.parts[pt] = {
          specs: [{ id, type: pt, version: 1, perf: 70, rel: 80, verified: true, expected: null, introduced: '存档升级' }],
          stock: { [id]: 1 },
        };
      }
      for (const car of team.cars) car.fitted[pt] ??= team.parts[pt].specs[0].id;
    }
  }

  for (const d of Object.values(state.drivers ?? {})) {
    const car = d.teamId ? state.teams[d.teamId]?.cars.find(c => c.driverId === d.id) : undefined;
    resetPuUsage(state, d, car);
  }

  return state;
}
