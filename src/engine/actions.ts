/**
 * 动作分发：前端/适配层修改存档的唯一入口。
 *
 * dispatch 是纯函数：输入旧存档，返回新存档（深拷贝），失败时返回原存档与错误原因。
 */
import { DEFAULT_PLAN, DRIVER_ATTRS, FACILITIES, LABELS } from './defaults';
import {
  cancelProject,
  fitPart,
  orderUnits,
  startDriverTraining,
  startPitTraining,
  startProject,
  upgradeFacility,
  type Outcome,
} from './development';
import { addNews, driverName } from './log';
import { Rng } from './rng';
import {
  doPractice,
  doQualifying,
  doRace,
  finishRound,
  nextActionFor,
  startNextSeason,
  startSeason,
  startWeekend,
  swapDriver,
} from './season';
import { validatePlan } from './strategy';
import type { Action, ActionResult, DriverPlan, GameState } from './types';
import { clamp, deepClone, hashString, round1 } from './util';

export interface DispatchOptions {
  now?: number;
}

const ok = (message: string): Outcome => ({ ok: true, message });
const fail = (message: string): Outcome => ({ ok: false, message });

const PROGRAMS = ['setup', 'longrun', 'quali_sim', 'parts'];
const APPROACHES = ['safe', 'standard', 'aggressive'];
const PACE = ['conserve', 'balanced', 'push'];
const TIMING = ['early', 'standard', 'late'];

function setPlan(state: GameState, driverId: string, patch: Partial<DriverPlan>): Outcome {
  const team = state.teams[state.meta.playerTeamId];
  if (!team.cars.some(c => c.driverId === driverId)) return fail('只能为本队正式车手设置策略');
  if (!state.weekend) return fail('比赛周末开始后才能设置本站策略');
  const plan = state.weekend.plans[driverId] ?? deepClone(DEFAULT_PLAN);
  const rules = state.rules;
  if (patch.practiceProgram !== undefined) {
    if (!PROGRAMS.includes(patch.practiceProgram)) return fail('未知练习赛项目');
    if (state.weekend.practice) return fail('练习赛已经结束');
    plan.practiceProgram = patch.practiceProgram;
  }
  if (patch.qualiApproach !== undefined) {
    if (!APPROACHES.includes(patch.qualiApproach)) return fail('未知排位方案');
    plan.qualiApproach = patch.qualiApproach;
  }
  if (patch.paceMode !== undefined) {
    if (!PACE.includes(patch.paceMode)) return fail('未知驾驶模式');
    plan.paceMode = patch.paceMode;
  }
  if (patch.pitTiming !== undefined) {
    if (!TIMING.includes(patch.pitTiming)) return fail('未知进站时机');
    plan.pitTiming = patch.pitTiming;
  }
  if (patch.scReaction !== undefined) plan.scReaction = !!patch.scReaction;
  if (patch.tyrePlan !== undefined) {
    if (patch.tyrePlan === 'auto') plan.tyrePlan = 'auto';
    else if (Array.isArray(patch.tyrePlan)) {
      const err = validatePlan(rules, patch.tyrePlan, false);
      if (err) return fail(err);
      plan.tyrePlan = [...patch.tyrePlan];
    } else return fail('轮胎策略格式错误');
  }
  if (patch.sprintTyre !== undefined) {
    if (patch.sprintTyre !== 'auto' && (!rules.tyres[patch.sprintTyre] || rules.tyres[patch.sprintTyre].wet)) return fail('冲刺赛配方无效');
    plan.sprintTyre = patch.sprintTyre;
  }
  state.weekend.plans[driverId] = plan;
  return ok(`已更新 ${driverName(state, driverId)} 的策略`);
}

function setPriority(state: GameState, driverId: string | null): Outcome {
  const team = state.teams[state.meta.playerTeamId];
  if (driverId !== null && state.drivers[driverId]?.teamId !== team.id) return fail('只能指定本队车手');
  if (team.driverPriority === driverId) return ok('优先车手没有变化');
  const key = `${state.season.number}-${state.season.roundIndex}`;
  if (state.flags.priorityChanged === key) return fail('每站只能调整一次优先车手');
  state.flags.priorityChanged = key;
  team.driverPriority = driverId;
  const mates = Object.values(state.drivers).filter(d => d.teamId === team.id);
  for (const d of mates) {
    if (driverId === null) {
      d.morale = round1(clamp(d.morale + 1, 0, 100));
    } else if (d.id === driverId) {
      d.morale = round1(clamp(d.morale + 3, 0, 100));
      d.trust = round1(clamp(d.trust + 2, 0, 100));
    } else {
      d.morale = round1(clamp(d.morale - (2 + d.ego / 25), 0, 100));
      d.trust = round1(clamp(d.trust - (1 + d.ego / 30), 0, 100));
    }
  }
  const msg = driverId ? `${driverName(state, driverId)} 被确立为车队优先车手` : '车队取消了优先车手，两位车手平等对待';
  addNews(state, '车队', `${msg}。`);
  return ok(msg);
}

function setTeamOrders(state: GameState, mode: string, favor: string | null): Outcome {
  if (!state.weekend) return fail('比赛周末开始后才能下达车队指令');
  const team = state.teams[state.meta.playerTeamId];
  if (mode !== 'free' && mode !== 'hold' && mode !== 'favor') return fail('未知车队指令');
  if (mode === 'favor' && (!favor || !team.cars.some(c => c.driverId === favor))) return fail('请选择要偏向的本队车手');
  state.weekend.teamOrders = { mode, favorDriverId: mode === 'favor' ? favor : null };
  const label = mode === 'favor' ? `偏向 ${driverName(state, favor)}` : LABELS.orders[mode];
  return ok(`车队指令：${label}`);
}

function run(state: GameState, action: Action, rng: Rng, depth = 0): Outcome {
  const tid = state.meta.playerTeamId;
  switch (action.type) {
    case 'ADVANCE': {
      const next = nextActionFor(state);
      if (!next || depth > 0) return fail('没有可推进的步骤');
      return run(state, next.action, rng, depth + 1);
    }
    case 'START_SEASON':
      return startSeason(state, rng);
    case 'START_WEEKEND':
      return startWeekend(state, rng);
    case 'RUN_PRACTICE':
      return doPractice(state, rng);
    case 'RUN_SPRINT_QUALIFYING':
      return doQualifying(state, rng, 'sprint_qualifying');
    case 'RUN_SPRINT':
      return doRace(state, rng, 'sprint');
    case 'RUN_QUALIFYING':
      return doQualifying(state, rng, 'qualifying');
    case 'RUN_RACE':
      return doRace(state, rng, 'race');
    case 'FINISH_ROUND':
      return finishRound(state, rng);
    case 'START_NEXT_SEASON':
      return startNextSeason(state, rng);
    case 'SET_PLAN':
      return setPlan(state, action.driverId, action.plan ?? {});
    case 'SET_TEAM_ORDERS':
      return setTeamOrders(state, action.orders?.mode, action.orders?.favorDriverId ?? null);
    case 'SET_PRIORITY':
      return setPriority(state, action.driverId ?? null);
    case 'START_PROJECT':
      return startProject(state, tid, action.partType, action.ambition, !!action.rush, rng);
    case 'CANCEL_PROJECT':
      return cancelProject(state, tid, action.projectId);
    case 'ORDER_UNITS':
      return orderUnits(state, tid, action.partType, action.specId, action.qty);
    case 'FIT_PART':
      return fitPart(state, tid, action.slot, action.partType, action.specId);
    case 'UPGRADE_FACILITY':
      if (!FACILITIES.includes(action.facility)) return fail('未知设施');
      return upgradeFacility(state, tid, action.facility);
    case 'TRAIN_PIT_CREW':
      return startPitTraining(state, tid);
    case 'TRAIN_DRIVER':
      if (!DRIVER_ATTRS.includes(action.attr)) return fail('未知能力项');
      return startDriverTraining(state, tid, action.driverId, action.attr);
    case 'SET_NEXT_SEASON_FOCUS': {
      const v = Math.round(clamp(Number(action.value) || 0, 0, 100));
      state.teams[tid].nextSeasonFocus = v;
      return ok(`下赛季研发投入比例设为 ${v}%`);
    }
    case 'SWAP_DRIVER':
      return swapDriver(state, tid, action.slot, action.driverId);
    case 'CLEAR_NARRATION':
      state.narration = [];
      return ok('已清空待叙述事件');
    default:
      return fail(`未知动作「${(action as { type?: string }).type ?? ''}」`);
  }
}

/** 会产生随机结果的动作（用于「每次重新随机」模式） */
const RANDOM_ACTIONS = new Set(['ADVANCE', 'START_SEASON', 'START_WEEKEND', 'RUN_PRACTICE', 'RUN_SPRINT_QUALIFYING', 'RUN_SPRINT', 'RUN_QUALIFYING', 'RUN_RACE', 'FINISH_ROUND', 'START_NEXT_SEASON', 'START_PROJECT']);

export function dispatch(input: GameState, action: Action, opts: DispatchOptions = {}): ActionResult {
  const state = deepClone(input);
  let seed = state.rng;
  if (state.meta.randomness === 'fresh' && RANDOM_ACTIONS.has(action?.type)) {
    seed = (seed ^ parseInt(hashString(String(opts.now ?? Date.now())), 16)) >>> 0;
  }
  const rng = new Rng(seed);
  let out: Outcome;
  try {
    out = run(state, action, rng);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, state: input, message: `内部错误：${msg}`, error: msg };
  }
  if (!out.ok) return { ok: false, state: input, message: out.message, error: out.message };
  state.rng = rng.state;
  return { ok: true, state, message: out.message };
}
