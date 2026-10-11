import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { normalizeDatabase, type RawSource } from '../src/engine/data';
import { createGame } from '../src/engine/newgame';
import { dispatch } from '../src/engine/actions';
import type { Action, Database, GameState } from '../src/engine/types';

const WB = resolve(__dirname, '../src/card/worldbook');

export const DATA_FILES: Array<[string, string]> = [
  ['[F1M数据] 规则', 'data-rules.yaml'],
  ['[F1M数据] 车队', 'data-teams.yaml'],
  ['[F1M数据] 车手', 'data-drivers.yaml'],
  ['[F1M数据] 赛道', 'data-tracks.yaml'],
  ['[F1M数据] 赛历', 'data-calendar.yaml'],
];

export function placeholderSources(): RawSource[] {
  return DATA_FILES.map(([name, file]) => ({ name, data: YAML.parse(readFileSync(resolve(WB, file), 'utf8')) }));
}

export function placeholderDb(): Database {
  const res = normalizeDatabase(placeholderSources());
  if (!res.canStart || !res.db) throw new Error(JSON.stringify(res.issues, null, 2));
  return res.db;
}

export function newTestGame(seed = 12345, playerTeamId = 'team_c'): GameState {
  return createGame(placeholderDb(), { playerTeamId, principalName: '测试领队', seed, gameId: 'gtest', now: 1_700_000_000_000 });
}

export function act(state: GameState, action: Action): GameState {
  const res = dispatch(state, action, { now: 1 });
  if (!res.ok) throw new Error(`${action.type} 失败：${res.message}`);
  return res.state;
}

export function tryAct(state: GameState, action: Action) {
  return dispatch(state, action, { now: 1 });
}

/** 一路 ADVANCE 直到满足条件 */
export function advanceUntil(state: GameState, pred: (s: GameState) => boolean, max = 200): GameState {
  let s = state;
  for (let i = 0; i < max && !pred(s); i++) s = act(s, { type: 'ADVANCE' });
  if (!pred(s)) throw new Error('advanceUntil: 条件未满足');
  return s;
}
