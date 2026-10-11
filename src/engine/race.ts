/**
 * 逐圈比赛模拟（正赛 / 冲刺赛）。
 *
 * 每圈：计算每台车的圈速（赛车 × 车手 × 调校 × 轮胎衰减 × 油量 × 驾驶模式 × 随机）→
 * 事故/故障判定 → 超车判定（DRS、赛道超车难度、缠斗能力、车队指令）→ 进站 →
 * 安全车/虚拟安全车。最终产出成绩表、关键事件、车手走势。
 */
import { DEFAULT_PLAN } from './defaults';
import { driverName } from './log';
import { activeEntries, carRatings, raceSkill, trackScore } from './ratings';
import type { Rng } from './rng';
import {
  degFactor,
  optimizeStints,
  PACE_MODE_TIME,
  planLabel,
  strategyOptions,
  tyreLapDelta,
  validatePlan,
  type StrategyOption,
} from './strategy';
import type {
  CarState,
  ClassificationEntry,
  Compound,
  DriverPlan,
  DriverState,
  GameState,
  RaceEvent,
  RaceResult,
  TeamState,
  TrackDef,
} from './types';
import { clamp, gapText, round3 } from './util';
import { currentTrack, planOf } from './weekend';

interface SimCar {
  driver: DriverState;
  team: TeamState;
  car: CarState;
  plan: DriverPlan;
  isPlayer: boolean;
  score: number;
  skill: number;
  carTyre: number;
  setupBonus: number;
  knowledge: number;
  factor: number;
  compounds: Compound[];
  stints: number[];
  stintIndex: number;
  tyre: Compound;
  tyreAge: number;
  used: Set<Compound>;
  pits: number;
  cum: number;
  laps: number;
  status: 'running' | 'dnf';
  reason: string;
  bestLap: number;
  damage: number;
  partial: number;
  repairPending: boolean;
  pFail: number;
  pCrash: number;
  grid: number;
  lapTime: number;
  newCum: number;
  pittedThisLap: boolean;
  crashedOut: boolean;
}

export interface RaceExtras {
  /** 本场因事故需要扣除的零件 [teamId, slot] */
  crashes: Array<{ teamId: string; slot: number; driverId: string; dnf: boolean }>;
}

const MIN_GAP = 0.25;

function chooseCompounds(
  state: GameState,
  sim: Pick<SimCar, 'team' | 'plan' | 'isPlayer'>,
  options: StrategyOption[],
  wet: boolean,
  sprint: boolean,
  rng: Rng,
): Compound[] {
  const rules = state.rules;
  if (wet) return options[0]?.compounds ?? [rules.wetCompound];
  if (sprint) {
    const t = sim.plan.sprintTyre;
    if (sim.isPlayer && t !== 'auto' && rules.tyres[t] && !rules.tyres[t].wet) return [t];
    return options[0]?.compounds ?? [rules.dryCompounds[1] ?? rules.dryCompounds[0]];
  }
  if (sim.isPlayer && sim.plan.tyrePlan !== 'auto' && !validatePlan(rules, sim.plan.tyrePlan, false)) {
    return [...sim.plan.tyrePlan];
  }
  // AI/自动：策略师越强越可能选到最优解
  const skill = sim.team.staff.strategist.skill;
  if (!sim.isPlayer && options.length > 1 && !rng.chance(0.45 + skill / 200)) return options[1].compounds;
  return options[0]?.compounds ?? [rules.dryCompounds[1], rules.dryCompounds[2] ?? rules.dryCompounds[0]];
}

/** 每场的机械故障概率（rel=85 约 4%，rel=70 约 10%） */
function raceFailProb(rel: number): number {
  return 0.49 * Math.pow(Math.max(0.01, 1 - rel / 100), 1.32);
}

export function simulateRace(state: GameState, rng: Rng, kind: 'race' | 'sprint'): { result: RaceResult; extras: RaceExtras } {
  const rules = state.rules;
  const w = state.weekend!;
  const track: TrackDef = currentTrack(state);
  const wet = (kind === 'race' ? w.weather.race : w.weather.sprint) === 'wet';
  const sprint = kind === 'sprint';
  const totalLaps = sprint ? Math.max(3, Math.round(track.laps * rules.sprintLapsFactor)) : track.laps;
  const quali = sprint ? w.sprintQualifying : w.qualifying;
  const entries = activeEntries(state);
  const gridOrder: string[] = quali?.grid?.filter(id => entries.some(e => e.driver.id === id)) ?? [];
  // 没有排位成绩（或有新车手）时按赛车性能补齐
  for (const e of [...entries].sort(
    (a, b) => trackScore(carRatings(b.team, b.car, rules), track) - trackScore(carRatings(a.team, a.car, rules), track),
  )) {
    if (!gridOrder.includes(e.driver.id)) gridOrder.push(e.driver.id);
  }

  const events: RaceEvent[] = [];
  const pushEvent = (lap: number, type: RaceEvent['type'], text: string, drivers: string[], key: boolean) => {
    if (events.length < 70 || type === 'finish') events.push({ lap, type, text, drivers, key });
  };
  const isKey = (...cars: SimCar[]) => cars.some(c => c.isPlayer);

  const cars: SimCar[] = gridOrder.map((id, gi) => {
    const e = entries.find(x => x.driver.id === id)!;
    const ratings = carRatings(e.team, e.car, rules);
    const plan = e.team.isPlayer ? planOf(state, id) : { ...DEFAULT_PLAN };
    const setup = w.setup[id] ?? { confidence: 40, tyreKnowledge: 30, qualiBonus: 0 };
    const ctx = { driverTyre: e.driver.attrs.tyre, carTyre: ratings.tyre, paceMode: plan.paceMode, knowledge: setup.tyreKnowledge };
    const factor = degFactor(track, ctx);
    const options = strategyOptions(rules, track, totalLaps, ctx, { wet, sprint });
    const sim: SimCar = {
      driver: e.driver,
      team: e.team,
      car: e.car,
      plan,
      isPlayer: e.team.isPlayer,
      score: trackScore(ratings, track),
      skill: raceSkill(e.driver, wet),
      carTyre: ratings.tyre,
      setupBonus: (setup.confidence / 100) * 0.3,
      knowledge: setup.tyreKnowledge,
      factor,
      compounds: [],
      stints: [],
      stintIndex: 0,
      tyre: rules.dryCompounds[0],
      tyreAge: 0,
      used: new Set(),
      pits: 0,
      cum: gi * 0.25,
      laps: 0,
      status: 'running',
      reason: '',
      bestLap: Infinity,
      damage: 0,
      partial: 0,
      repairPending: false,
      pFail: 0,
      pCrash: 0,
      grid: gi + 1,
      lapTime: 0,
      newCum: 0,
      pittedThisLap: false,
      crashedOut: false,
    };
    sim.compounds = chooseCompounds(state, sim, options, wet, sprint, rng);
    sim.stints = optimizeStints(rules, track, sim.compounds, totalLaps, factor);
    // 进站时机偏好：提前（Undercut）/ 推迟（Overcut）
    const shift = plan.pitTiming === 'early' ? -2 : plan.pitTiming === 'late' ? 2 : 0;
    if (shift && sim.stints.length > 1) {
      for (let i = 0; i < sim.stints.length - 1; i++) {
        const moved = clamp(sim.stints[i] + shift, 3, sim.stints[i] + sim.stints[i + 1] - 3);
        sim.stints[i + 1] -= moved - sim.stints[i];
        sim.stints[i] = moved;
      }
    }
    sim.tyre = sim.compounds[0];
    sim.used.add(sim.tyre);
    const modeRisk = plan.paceMode === 'push' ? 1.4 : plan.paceMode === 'conserve' ? 0.7 : 1;
    sim.pFail = (raceFailProb(ratings.reliability) * modeRisk) / track.laps;
    const crashRace = (0.02 + ((100 - e.driver.attrs.consistency) / 100) * 0.06) * (wet ? 2.5 : 1) * (plan.paceMode === 'push' ? 1.4 : 1);
    sim.pCrash = crashRace / track.laps;
    return sim;
  });

  const extras: RaceExtras = { crashes: [] };
  const lapChart: Record<string, number[]> = {};
  for (const c of cars) if (c.isPlayer) lapChart[c.driver.id] = [];
  let fastest: RaceResult['fastestLap'] = null;
  let scLeft = 0;
  let vscLeft = 0;
  let safetyCars = 0;
  const orderOutcomes: RaceResult['orderOutcomes'] = [];
  const orderCooldown = new Map<string, number>();
  const orders = w.teamOrders;

  const running = () => cars.filter(c => c.status === 'running');
  const deploy = (lap: number, crash: boolean) => {
    if (scLeft > 0 || vscLeft > 0) return;
    if (crash && rng.chance(track.scChance)) {
      scLeft = rng.int(3, 5);
      safetyCars += 1;
      pushEvent(lap, 'sc', '安全车出动！', [], true);
    } else if (rng.chance(crash ? 0.85 : 0.45)) {
      vscLeft = 2;
      pushEvent(lap, 'vsc', '虚拟安全车（VSC）', [], true);
    }
  };

  for (let lap = 1; lap <= totalLaps; lap++) {
    const scActive = scLeft > 0;
    const vscActive = vscLeft > 0;
    const field = running().sort((a, b) => a.cum - b.cum);

    // 1) 圈速
    for (const c of field) {
      c.pittedThisLap = false;
      const base =
        track.baseLap * (wet ? 1.12 : 1) +
        (100 - c.score) * rules.secPerCarPoint +
        (100 - c.skill) * rules.secPerDriverPoint -
        c.setupBonus;
      const tyre = tyreLapDelta(rules.tyres[c.tyre], c.tyreAge + 1, c.factor);
      const fuel = (totalLaps - lap) * 0.03;
      const sigma = (0.12 + (100 - c.driver.attrs.consistency) * 0.004) * (wet ? 1.5 : 1);
      let t = base + tyre + fuel + PACE_MODE_TIME[c.plan.paceMode] + c.damage + c.partial + rng.normal(0, sigma);
      if (lap === 1) t += 2.5 + rng.normal(0, 0.35) - (c.driver.attrs.racecraft - 75) * 0.008;
      if (scActive) t = track.baseLap * 1.35 + rng.normal(0, 0.05);
      else if (vscActive) t = (base + tyre) * 1.25 + rng.normal(0, 0.05);
      c.lapTime = t;
    }

    // 2) 故障与事故（安全车期间不判定）
    if (!scActive && !vscActive) {
      for (const c of field) {
        if (rng.chance(c.pFail)) {
          if (rng.chance(0.35) && c.partial === 0) {
            c.partial = rng.range(0.6, 1.2);
            pushEvent(lap, 'damage', `${driverName(state, c.driver.id)} 赛车出现故障，动力下降`, [c.driver.id], isKey(c));
          } else {
            c.status = 'dnf';
            c.reason = rng.pick(['动力单元故障', '变速箱故障', '液压故障', '刹车过热', '冷却系统故障']);
            pushEvent(lap, 'dnf', `${driverName(state, c.driver.id)} 因${c.reason}退赛`, [c.driver.id], true);
            deploy(lap, false);
          }
        } else if (rng.chance(c.pCrash * (lap === 1 ? 4 : 1))) {
          extras.crashes.push({ teamId: c.team.id, slot: c.car.slot, driverId: c.driver.id, dnf: false });
          if (rng.chance(0.4)) {
            c.damage = 0.9;
            c.repairPending = true;
            c.lapTime += rng.range(2, 6);
            pushEvent(lap, 'error', `${driverName(state, c.driver.id)} 失误触碰护墙，前翼受损需要进站`, [c.driver.id], isKey(c));
          } else {
            c.status = 'dnf';
            c.reason = wet ? '雨中失控撞车' : '失误撞车';
            c.crashedOut = true;
            extras.crashes[extras.crashes.length - 1].dnf = true;
            pushEvent(lap, 'dnf', `${driverName(state, c.driver.id)} ${c.reason}，退赛！`, [c.driver.id], true);
            deploy(lap, true);
          }
        }
      }
    }

    // 3) 位置与超车
    const order = field.filter(c => c.status === 'running');
    for (const c of order) c.newCum = c.cum + c.lapTime;
    if (!scActive && !vscActive && lap > 1) {
      for (let i = 1; i < order.length; i++) {
        const B = order[i];
        const A = order[i - 1];
        if (A.status !== 'running' || B.status !== 'running') continue;
        const gapStart = B.cum - A.cum;
        const wouldCatch = B.newCum < A.newCum + MIN_GAP;
        if (!wouldCatch) continue;
        if (gapStart > 1.5) continue; // 不在同一段赛道（如对手刚进站），自然换位
        const teammates = A.team.id === B.team.id;
        // 车队指令：保持位置
        if (teammates && A.isPlayer && orders.mode === 'hold') {
          B.newCum = A.newCum + MIN_GAP + 0.4;
          continue;
        }
        const drs = !wet && gapStart < 1 ? 0.35 : 0;
        const adv =
          A.lapTime - B.lapTime + drs + (B.driver.attrs.racecraft - A.driver.attrs.racecraft) * 0.006 + (B.plan.paceMode === 'push' ? 0.08 : 0);
        const threshold = 0.25 + ((100 - track.overtaking) / 100) * 1.3;
        const p = 1 / (1 + Math.exp(-4 * (adv - threshold)));
        if (rng.chance(p)) {
          // 碰撞风险
          const minCraft = Math.min(A.driver.attrs.racecraft, B.driver.attrs.racecraft);
          const pCol = 0.006 * (1 + Math.max(0, 75 - minCraft) / 25) * (wet ? 2 : 1);
          if (rng.chance(pCol)) {
            const victim = rng.chance(0.5) ? A : B;
            victim.status = 'dnf';
            victim.reason = `与 ${driverName(state, (victim === A ? B : A).driver.id)} 碰撞`;
            victim.crashedOut = true;
            extras.crashes.push({ teamId: victim.team.id, slot: victim.car.slot, driverId: victim.driver.id, dnf: true });
            pushEvent(lap, 'dnf', `${driverName(state, B.driver.id)} 与 ${driverName(state, A.driver.id)} 争位时发生碰撞，${driverName(state, victim.driver.id)} 退赛！`, [A.driver.id, B.driver.id], true);
            deploy(lap, true);
            continue;
          }
          B.newCum = Math.min(B.newCum, A.newCum - 0.1 - rng.range(0, 0.3));
          order[i - 1] = B;
          order[i] = A;
          if (isKey(A, B) || i <= 3) {
            pushEvent(lap, 'overtake', `${driverName(state, B.driver.id)} 超越 ${driverName(state, A.driver.id)}，升至 P${i}`, [B.driver.id, A.driver.id], isKey(A, B) || i <= 3);
          }
        } else {
          B.newCum = A.newCum + MIN_GAP + rng.range(0, 0.35);
        }
      }
      // 车队指令：偏向某位车手（让车）
      if (orders.mode === 'favor' && orders.favorDriverId) {
        for (let i = 1; i < order.length; i++) {
          const fav = order[i];
          const mate = order[i - 1];
          if (fav.driver.id !== orders.favorDriverId || mate.team.id !== fav.team.id || !fav.isPlayer) continue;
          const key = `${mate.driver.id}>${fav.driver.id}`;
          if ((orderCooldown.get(key) ?? 0) > lap) continue;
          if (fav.newCum - mate.newCum > 2.5 || totalLaps - lap < 2) continue;
          orderCooldown.set(key, lap + 8);
          const comply = clamp(0.95 - mate.driver.ego / 250 + (mate.driver.trust - 50) / 200, 0.3, 0.98);
          const complied = rng.chance(comply);
          orderOutcomes.push({ lap, yielded: mate.driver.id, favored: fav.driver.id, complied });
          if (complied) {
            const t = mate.newCum;
            mate.newCum = fav.newCum + 0.3;
            fav.newCum = Math.min(fav.newCum, t);
            order[i - 1] = fav;
            order[i] = mate;
            pushEvent(lap, 'order', `车队指令：${driverName(state, mate.driver.id)} 让出位置给 ${driverName(state, fav.driver.id)}`, [mate.driver.id, fav.driver.id], true);
          } else {
            pushEvent(lap, 'order', `${driverName(state, mate.driver.id)} 拒绝执行车队指令，不肯让车给 ${driverName(state, fav.driver.id)}！`, [mate.driver.id, fav.driver.id], true);
          }
        }
      }
    }

    // 4) 进站
    for (const c of order) {
      if (c.status !== 'running') continue;
      c.tyreAge += 1;
      const lapsLeft = totalLaps - lap;
      const planned = c.stintIndex < c.compounds.length - 1;
      const target = c.stints[c.stintIndex] ?? totalLaps;
      const cliff = rules.tyres[c.tyre].cliff;
      let reason = '';
      if (lapsLeft > 0) {
        if (c.repairPending) reason = 'repair';
        else if (planned && c.tyreAge >= target) reason = 'plan';
        else if (planned && (scActive || vscActive) && c.plan.scReaction && c.tyreAge >= target * 0.5) reason = 'sc';
        else if (!planned && lapsLeft > 6 && c.tyreAge > cliff * 1.35 + 4) reason = 'extra';
      }
      if (!reason) continue;
      const lossBase = scActive ? track.pitLoss * 0.5 : vscActive ? track.pitLoss * 0.7 : track.pitLoss;
      const crew = c.team.staff.pitCrew.skill;
      let stationary = 2.2 + ((100 - crew) / 100) * 1.3 + rng.range(0, 0.4);
      let slow = false;
      if (rng.chance(((100 - crew) / 100) * 0.12)) {
        stationary += rng.range(2, 6);
        slow = true;
      }
      if (reason === 'repair') {
        stationary += 6;
        c.repairPending = false;
        c.damage = 0;
      }
      if (reason === 'plan' || reason === 'sc' || (reason === 'repair' && planned && c.tyreAge >= target * 0.5)) {
        c.stintIndex += 1;
        c.tyre = c.compounds[c.stintIndex];
      } else if (reason === 'extra') {
        // 计划外进站：换上能撑到终点的配方
        const pick = wet ? rules.wetCompound : lapsLeft > 18 ? rules.dryCompounds[rules.dryCompounds.length - 1] : rules.dryCompounds[0];
        c.compounds.push(pick);
        c.stints.push(lapsLeft);
        c.stintIndex = c.compounds.length - 1;
        c.tyre = pick;
      }
      c.used.add(c.tyre);
      c.tyreAge = 0;
      c.pits += 1;
      c.newCum += lossBase + stationary;
      c.pittedThisLap = true;
      const label = reason === 'repair' ? '进站更换前翼' : reason === 'sc' ? '趁安全车进站' : reason === 'extra' ? '计划外进站' : '进站';
      if (c.isPlayer || slow) {
        pushEvent(
          lap,
          slow ? 'slow_stop' : 'pit',
          `${driverName(state, c.driver.id)} ${label}，换上${rules.tyres[c.tyre].name}（静止 ${stationary.toFixed(1)}s${slow ? '，进站失误！' : ''}）`,
          [c.driver.id],
          c.isPlayer,
        );
      }
    }

    // 5) 落定本圈
    for (const c of order) {
      if (c.status !== 'running') continue;
      const actual = c.newCum - c.cum;
      c.cum = c.newCum;
      c.laps = lap;
      if (!scActive && !vscActive && lap > 1 && !c.pittedThisLap && actual < c.bestLap) c.bestLap = actual;
      if (!scActive && !vscActive && lap > 1 && !c.pittedThisLap && (!fastest || actual < fastest.time)) {
        fastest = { driverId: c.driver.id, time: round3(actual), lap };
      }
    }
    // 安全车结束：压缩差距
    if (scActive) {
      scLeft -= 1;
      if (scLeft === 0) {
        const r = running().sort((a, b) => a.cum - b.cum);
        r.forEach((c, i) => {
          if (i > 0) c.cum = r[0].cum + i * 0.7;
        });
        pushEvent(lap, 'sc_end', '安全车回站，比赛重新开始', [], true);
      }
    } else if (vscActive) {
      vscLeft -= 1;
      if (vscLeft === 0) pushEvent(lap, 'sc_end', 'VSC 结束', [], false);
    }
    // 走势
    const pos = running().sort((a, b) => a.cum - b.cum);
    for (const id of Object.keys(lapChart)) {
      const idx = pos.findIndex(c => c.driver.id === id);
      lapChart[id].push(idx >= 0 ? idx + 1 : 0);
    }
    if (lap === 1) {
      for (const c of pos) {
        const p = pos.indexOf(c) + 1;
        if (c.isPlayer && p !== c.grid) {
          pushEvent(1, 'start', `${driverName(state, c.driver.id)} 起步 ${p < c.grid ? `抢下 ${c.grid - p} 个位置` : `丢掉 ${p - c.grid} 个位置`}（P${c.grid}→P${p}）`, [c.driver.id], true);
        }
      }
    }
  }

  // 违规：干地正赛未满足配方数量 +10 秒
  if (!wet && !sprint) {
    for (const c of running()) {
      if (c.used.size < rules.mandatoryCompounds) {
        c.cum += 10;
        pushEvent(totalLaps, 'info', `${driverName(state, c.driver.id)} 未满足轮胎配方规定，罚时 10 秒`, [c.driver.id], true);
      }
    }
  }

  // 成绩
  const finishers = running().sort((a, b) => a.cum - b.cum);
  const dnfs = cars.filter(c => c.status === 'dnf').sort((a, b) => b.laps - a.laps || a.cum - b.cum);
  const points = sprint ? rules.pointsSprint : rules.pointsRace;
  const leader = finishers[0];
  const classification: ClassificationEntry[] = [];
  finishers.forEach((c, i) => {
    const gap = c.cum - (leader?.cum ?? c.cum);
    const lapped = gap > track.baseLap ? Math.floor(gap / track.baseLap) : 0;
    classification.push({
      driverId: c.driver.id,
      teamId: c.team.id,
      pos: i + 1,
      grid: c.grid,
      status: 'finished',
      laps: lapped ? totalLaps - lapped : totalLaps,
      time: round3(c.cum),
      gap: i === 0 ? '冠军' : lapped ? `+${lapped} 圈` : gapText(gap),
      pits: c.pits,
      bestLap: Number.isFinite(c.bestLap) ? round3(c.bestLap) : 0,
      points: points[i] ?? 0,
      reason: '',
      tyres: [...c.compounds.slice(0, c.stintIndex + 1)],
    });
  });
  for (const c of dnfs) {
    classification.push({
      driverId: c.driver.id,
      teamId: c.team.id,
      pos: null,
      grid: c.grid,
      status: 'dnf',
      laps: c.laps,
      time: round3(c.cum),
      gap: 'DNF',
      pits: c.pits,
      bestLap: Number.isFinite(c.bestLap) ? round3(c.bestLap) : 0,
      points: 0,
      reason: c.reason,
      tyres: [...c.compounds.slice(0, c.stintIndex + 1)],
    });
  }
  // 最快圈加分
  const fl = fastest as RaceResult['fastestLap'];
  if (!sprint && rules.fastestLapPoint > 0 && fl) {
    const entry = classification.find(c => c.driverId === fl.driverId);
    if (entry && entry.pos !== null && entry.pos <= rules.fastestLapTopN) entry.points += rules.fastestLapPoint;
  }
  if (fl) pushEvent(fl.lap, 'fastest', `最快圈：${driverName(state, fl.driverId)}（第 ${fl.lap} 圈）`, [fl.driverId], false);
  if (leader) {
    pushEvent(totalLaps, 'finish', `${driverName(state, leader.driver.id)} 赢得${sprint ? '冲刺赛' : '正赛'}！`, [leader.driver.id], true);
  }
  for (const c of finishers) {
    if (c.isPlayer) {
      const e = classification.find(x => x.driverId === c.driver.id)!;
      pushEvent(totalLaps, 'finish', `${driverName(state, c.driver.id)} 第 ${e.pos} 名完赛（发车 P${c.grid}，${planLabel(rules, e.tyres)}）`, [c.driver.id], true);
    }
  }

  const result: RaceResult = {
    kind,
    weather: wet ? 'wet' : 'dry',
    laps: totalLaps,
    classification,
    events,
    fastestLap: fl,
    lapChart,
    safetyCars,
    orderOutcomes,
  };
  return { result, extras };
}
