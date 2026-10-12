/**
 * 视图模型：把存档加工成前端直接可用的数据（评分、排名、预览、标签）。
 * 前端只读视图、只通过动作修改存档，保证所有规则都在引擎里。
 */
import { AMBITIONS, FACILITIES, LABELS, STAFF_ROLES } from './defaults';
import {
  allocationGap,
  previewFacility,
  previewPitTraining,
  previewProject,
  rankOfTeam,
  rndSlots,
  type ProjectPreview,
} from './development';
import { annualSalaries, capRemaining } from './finance';
import { describeLog } from './protocol';
import { carRatings, disclosedPerf, driverOverall, findSpec, moraleLabel, teamPaceRanking, trackScore, type CarRatings } from './ratings';
import { nextActionFor, sortedDrivers, sortedTeams, type NextAction } from './season';
import { degFactor, effectiveCliff, strategyOptions, type StrategyOption } from './strategy';
import type {
  DriverState,
  GameState,
  Phase,
  Project,
  RaceResult,
  QualiResult,
  PracticeResult,
  TeamState,
  TrackDef,
  WeekendState,
  Weather,
  DriverPlan,
  SetupState,
  RoundSummary,
} from './types';
import { round1 } from './util';
import { currentRound } from './weekend';

export interface PartView {
  type: string;
  name: string;
  specId: string;
  version: number;
  /** 已验证时为真实性能，否则为预估区间中值 */
  perf: number;
  rel: number;
  verified: boolean;
  expected: [number, number] | null;
}

export interface CarView {
  slot: number;
  driverId: string | null;
  driverName: string;
  ratings: CarRatings;
  trackScore: number | null;
  parts: PartView[];
}

export interface StockView {
  partType: string;
  partName: string;
  specId: string;
  version: number;
  count: number;
  perf: number;
  rel: number;
  verified: boolean;
  expected: [number, number] | null;
  fittedOn: number[];
}

export interface ProjectView extends Project {
  progress: number;
}

export interface DriverView {
  id: string;
  name: string;
  short: string;
  number: number;
  nationality: string;
  age: number;
  teamId: string | null;
  teamName: string;
  teamColor: string;
  role: 'race' | 'reserve';
  attrs: DriverState['attrs'];
  overall: number;
  potential: number;
  morale: number;
  moraleLabel: string;
  fitness: number;
  trust: number;
  form: number;
  ego: number;
  salary: number;
  contractEnd: number;
  traits: string[];
  description: string;
  points: number;
  position: number | null;
  wins: number;
  podiums: number;
  isPlayerTeam: boolean;
  isPriority: boolean;
  slot: number | null;
}

export interface WeekendDriverView {
  driverId: string;
  driverName: string;
  plan: DriverPlan;
  setup: SetupState;
  options: StrategyOption[];
  sprintOptions: StrategyOption[];
  tyreLife: Record<string, number>;
}

export type RevealedWeather = Record<keyof WeekendState['weather'], Weather | null>;

const SESSION_ORDER: Phase[] = ['practice', 'sprint_qualifying', 'sprint', 'qualifying', 'race', 'post_race'];

/** 只公开「已经到来」的场次天气，未来场次只给预报，避免剧透 */
export function revealedWeather(w: WeekendState, phase: Phase, isCurrent: boolean): RevealedWeather {
  const idx = isCurrent ? SESSION_ORDER.indexOf(phase) : SESSION_ORDER.length;
  const at = (p: Phase) => idx >= SESSION_ORDER.indexOf(p);
  return {
    practice: at('practice') ? w.weather.practice : null,
    sprintQualifying: at('sprint_qualifying') ? w.weather.sprintQualifying : null,
    sprint: at('sprint') ? w.weather.sprint : null,
    qualifying: at('qualifying') ? w.weather.qualifying : null,
    race: at('race') ? w.weather.race : null,
  };
}

export interface WeekendView {
  roundIndex: number;
  isCurrent: boolean;
  weather: RevealedWeather;
  forecast: WeekendState['forecast'];
  parcFerme: boolean;
  teamOrders: WeekendState['teamOrders'];
  penalties: Record<string, number>;
  drivers: WeekendDriverView[];
  practice: PracticeResult | null;
  sprintQualifying: QualiResult | null;
  sprint: RaceResult | null;
  qualifying: QualiResult | null;
  race: RaceResult | null;
}

export interface GameView {
  gameId: string;
  meta: GameState['meta'];
  season: GameState['season'] & { rounds: number; phaseLabel: string };
  next: NextAction | null;
  round: { index: number; name: string; sprint: boolean; dateLabel: string; weeksGap: number; track: TrackDef } | null;
  player: {
    team: TeamState;
    rank: number;
    points: number;
    leaderPoints: number;
    capRemaining: number;
    annualSalaries: number;
    rndSlots: number;
    allocationGap: number;
    cars: CarView[];
    stock: StockView[];
    projects: ProjectView[];
    rndOptions: ProjectPreview[];
    facilities: Array<{ id: string; name: string; level: number; max: number; preview: ReturnType<typeof previewFacility> }>;
    staff: Array<{ role: string; label: string; name: string; skill: number; salary: number }>;
    pitTraining: ReturnType<typeof previewPitTraining>;
  };
  teams: Array<{ id: string; name: string; short: string; color: string; isPlayer: boolean; points: number; rank: number; carOverall: number; trackScore: number | null; paceRank: number | null }>;
  drivers: DriverView[];
  standings: {
    drivers: Array<{ pos: number; driverId: string; name: string; teamId: string | null; teamName: string; color: string; points: number; wins: number; podiums: number; results: Array<number | 'DNF' | null> }>;
    teams: Array<{ pos: number; teamId: string; name: string; color: string; points: number; wins: number; podiums: number }>;
  };
  calendar: Array<{ index: number; id: string; name: string; trackName: string; trackType: string; sprint: boolean; dateLabel: string; status: 'done' | 'current' | 'upcoming'; winner: string | null; playerBest: number | null }>;
  weekend: WeekendView | null;
  history: RoundSummary[];
  news: GameState['news'];
  narration: GameState['narration'];
  narrated: GameState['narrated'];
  aiLog: Array<GameState['aiLog'][number] & { text: string }>;
  flags: GameState['flags'];
  lastSeason: GameState['lastSeason'];
  labels: typeof LABELS & {
    parts: Record<string, string>;
    tyres: Record<string, { name: string; short: string; color: string; wet: boolean }>;
    facilities: Record<string, string>;
    ambition: Record<string, string>;
  };
  rules: {
    costCap: number;
    dryCompounds: string[];
    wetCompound: string;
    mandatoryCompounds: number;
    aiLimits: GameState['rules']['aiLimits'];
  };
}

function partView(team: TeamState, type: string, specId: string, name: string): PartView {
  const s = findSpec(team, type, specId) ?? team.parts[type]?.specs[0];
  const perf = s ? disclosedPerf(s) : 0;
  return {
    type,
    name,
    specId: s?.id ?? specId,
    version: s?.version ?? 0,
    perf,
    rel: s?.rel ?? 0,
    verified: s?.verified ?? true,
    expected: s?.expected ?? null,
  };
}

function driverView(state: GameState, d: DriverState, positions: Map<string, number>): DriverView {
  const team = d.teamId ? state.teams[d.teamId] : undefined;
  const st = state.standings.drivers[d.id];
  const car = team?.cars.find(c => c.driverId === d.id);
  return {
    id: d.id,
    name: d.name,
    short: d.short,
    number: d.number,
    nationality: d.nationality,
    age: d.age,
    teamId: d.teamId,
    teamName: team?.name ?? '自由车手',
    teamColor: team?.color ?? '#666',
    role: d.role,
    attrs: { ...d.attrs },
    overall: driverOverall(d),
    potential: d.potential,
    morale: d.morale,
    moraleLabel: moraleLabel(d.morale),
    fitness: d.fitness,
    trust: d.trust,
    form: d.form,
    ego: d.ego,
    salary: d.salary,
    contractEnd: d.contractEnd,
    traits: [...d.traits],
    description: d.description,
    points: st?.points ?? 0,
    position: positions.get(d.id) ?? null,
    wins: st?.wins ?? 0,
    podiums: st?.podiums ?? 0,
    isPlayerTeam: d.teamId === state.meta.playerTeamId,
    isPriority: !!team && team.driverPriority === d.id,
    slot: car?.slot ?? null,
  };
}

export function buildView(state: GameState): GameView {
  const rules = state.rules;
  const team = state.teams[state.meta.playerTeamId];
  const roundDef = currentRound(state);
  const track = roundDef ? state.tracks[roundDef.trackId] : undefined;
  const phase: Phase = state.season.phase;
  const showTrack = phase !== 'season_end' && !!track;
  const paceRanking = teamPaceRanking(state, showTrack ? track! : null, 'disclosed');
  const teamRows = sortedTeams(state);
  const driverRows = sortedDrivers(state);
  const driverPos = new Map(driverRows.map((id, i) => [id, i + 1]));

  const partNames = Object.fromEntries(Object.entries(rules.parts).map(([k, v]) => [k, v.name]));
  const cars: CarView[] = team.cars.map(c => {
    const ratings = carRatings(team, c, rules, 'disclosed');
    return {
      slot: c.slot,
      driverId: c.driverId,
      driverName: c.driverId ? state.drivers[c.driverId]?.name ?? c.driverId : '（空）',
      ratings,
      trackScore: showTrack ? round1(trackScore(ratings, track!)) : null,
      parts: Object.keys(rules.parts).map(pt => partView(team, pt, c.fitted[pt], partNames[pt])),
    };
  });

  const stock: StockView[] = [];
  for (const [pt, parts] of Object.entries(team.parts)) {
    for (const s of parts.specs) {
      const fittedOn = team.cars.filter(c => c.fitted[pt] === s.id).map(c => c.slot);
      const count = parts.stock[s.id] ?? 0;
      if (count <= 0 && fittedOn.length === 0) continue;
      stock.push({
        partType: pt,
        partName: partNames[pt] ?? pt,
        specId: s.id,
        version: s.version,
        count,
        perf: disclosedPerf(s),
        rel: s.rel,
        verified: s.verified,
        expected: s.expected,
        fittedOn,
      });
    }
  }

  const projects: ProjectView[] = team.projects.map(p => {
    const { trueGain: _hidden, ...rest } = p;
    return { ...rest, progress: round1(((p.weeksTotal - p.weeksLeft) / Math.max(1, p.weeksTotal)) * 100) };
  });

  // 原始零件规格里未验证新件的真实性能要遮住，面板只能拿到预估值
  const maskedParts = Object.fromEntries(
    Object.entries(team.parts).map(([pt, parts]) => [pt, { ...parts, specs: parts.specs.map(s => ({ ...s, perf: disclosedPerf(s) })) }]),
  );

  const rndOptions: ProjectPreview[] = [];
  for (const pt of Object.keys(rules.parts)) {
    if (!rules.parts[pt].developable) continue;
    for (const amb of AMBITIONS) rndOptions.push(previewProject(state, team.id, pt, amb, false));
  }

  const weekend = buildWeekendView(state);

  return {
    gameId: state.gameId,
    meta: state.meta,
    season: { ...state.season, rounds: state.calendar.length, phaseLabel: LABELS.phase[phase] },
    next: nextActionFor(state),
    round:
      roundDef && track
        ? {
            index: state.season.roundIndex,
            name: roundDef.name || `${track.name}大奖赛`,
            sprint: roundDef.sprint,
            dateLabel: roundDef.dateLabel,
            weeksGap: roundDef.weeksGap,
            track,
          }
        : null,
    player: {
      team: { ...team, parts: maskedParts, projects: projects as Project[] },
      rank: rankOfTeam(state, team.id),
      points: state.standings.teams[team.id]?.points ?? 0,
      leaderPoints: Math.max(0, ...Object.values(state.standings.teams).map(t => t.points)),
      capRemaining: capRemaining(team, rules),
      annualSalaries: round1(annualSalaries(state, team)),
      rndSlots: rndSlots(team, rules),
      allocationGap: allocationGap(state, team),
      cars,
      stock,
      projects,
      rndOptions,
      facilities: FACILITIES.map(f => ({
        id: f,
        name: rules.facilities[f].name,
        level: team.facilities[f],
        max: rules.facilities[f].maxLevel,
        preview: previewFacility(state, team.id, f),
      })),
      staff: STAFF_ROLES.map(r => ({ role: r, label: LABELS.staff[r], name: team.staff[r].name, skill: team.staff[r].skill, salary: team.staff[r].salary })),
      pitTraining: previewPitTraining(state, team.id),
    },
    teams: teamRows.map((tid, i) => {
      const t = state.teams[tid];
      const best = Math.max(...t.cars.map(c => carRatings(t, c, rules, 'disclosed').overall), 0);
      const pr = paceRanking.findIndex(p => p.teamId === tid);
      return {
        id: tid,
        name: t.name,
        short: t.short,
        color: t.color,
        isPlayer: t.isPlayer,
        points: state.standings.teams[tid]?.points ?? 0,
        rank: i + 1,
        carOverall: round1(best),
        trackScore: showTrack ? paceRanking[pr]?.score ?? null : null,
        paceRank: showTrack ? pr + 1 : null,
      };
    }),
    drivers: Object.values(state.drivers).map(d => driverView(state, d, driverPos)),
    standings: {
      drivers: driverRows.map((id, i) => {
        const d = state.drivers[id];
        const s = state.standings.drivers[id];
        const t = d?.teamId ? state.teams[d.teamId] : undefined;
        return {
          pos: i + 1,
          driverId: id,
          name: d?.name ?? id,
          teamId: d?.teamId ?? null,
          teamName: t?.name ?? '',
          color: t?.color ?? '#666',
          points: s.points,
          wins: s.wins,
          podiums: s.podiums,
          results: s.results,
        };
      }),
      teams: teamRows.map((tid, i) => ({
        pos: i + 1,
        teamId: tid,
        name: state.teams[tid].name,
        color: state.teams[tid].color,
        points: state.standings.teams[tid]?.points ?? 0,
        wins: state.standings.teams[tid]?.wins ?? 0,
        podiums: state.standings.teams[tid]?.podiums ?? 0,
      })),
    },
    calendar: state.calendar.map((r, i) => {
      const h = state.history.find(x => x.roundIndex === i);
      const t = state.tracks[r.trackId];
      const mine = h ? h.results.filter(([id]) => state.drivers[id]?.teamId === team.id).map(([, pos]) => pos).filter((p): p is number => p !== null) : [];
      const status: 'done' | 'current' | 'upcoming' =
        h ? 'done' : i === state.season.roundIndex && state.season.phase !== 'season_end' ? 'current' : i < state.season.roundIndex ? 'done' : 'upcoming';
      return {
        index: i,
        id: r.id,
        name: r.name || `${t?.name ?? r.trackId}大奖赛`,
        trackName: t?.name ?? r.trackId,
        trackType: t?.type ?? '',
        sprint: r.sprint,
        dateLabel: r.dateLabel,
        status,
        winner: h?.winner ? state.drivers[h.winner]?.name ?? h.winner : null,
        playerBest: mine.length ? Math.min(...mine) : null,
      };
    }),
    weekend,
    history: state.history,
    news: [...state.news].reverse(),
    narration: state.narration,
    narrated: state.narrated,
    aiLog: [...state.aiLog].reverse().map(e => ({ ...e, text: describeLog(state, e) })),
    flags: state.flags,
    lastSeason: state.lastSeason,
    labels: {
      ...LABELS,
      parts: partNames,
      tyres: Object.fromEntries(Object.entries(rules.tyres).map(([k, v]) => [k, { name: v.name, short: v.short, color: v.color, wet: v.wet }])),
      facilities: Object.fromEntries(FACILITIES.map(f => [f, rules.facilities[f].name])),
      ambition: Object.fromEntries(AMBITIONS.map(a => [a, rules.ambition[a].name])),
    },
    rules: {
      costCap: rules.costCap,
      dryCompounds: rules.dryCompounds,
      wetCompound: rules.wetCompound,
      mandatoryCompounds: rules.mandatoryCompounds,
      aiLimits: rules.aiLimits,
    },
  };
}

function buildWeekendView(state: GameState): WeekendView | null {
  const w = state.weekend;
  if (!w) return null;
  const team = state.teams[state.meta.playerTeamId];
  const roundDef = state.calendar[w.roundIndex];
  const track = roundDef ? state.tracks[roundDef.trackId] : undefined;
  const isCurrent = w.roundIndex === state.season.roundIndex && state.season.phase !== 'pre_race' && state.season.phase !== 'season_end';
  const drivers: WeekendDriverView[] = [];
  if (track) {
    for (const car of team.cars) {
      if (!car.driverId) continue;
      const d = state.drivers[car.driverId];
      const plan = w.plans[d.id];
      const setup = w.setup[d.id];
      if (!plan || !setup) continue;
      const ratings = carRatings(team, car, state.rules, 'disclosed');
      const ctx = { driverTyre: d.attrs.tyre, carTyre: ratings.tyre, paceMode: plan.paceMode, knowledge: setup.tyreKnowledge };
      const sprintLaps = Math.max(3, Math.round(track.laps * state.rules.sprintLapsFactor));
      const factor = degFactor(track, ctx);
      drivers.push({
        driverId: d.id,
        driverName: d.name,
        plan,
        setup,
        // 玩家看到的是「干地」策略预测（雨战由引擎自动换雨胎）
        options: strategyOptions(state.rules, track, track.laps, ctx, { wet: false, sprint: false }).slice(0, 6),
        sprintOptions: roundDef?.sprint ? strategyOptions(state.rules, track, sprintLaps, ctx, { wet: false, sprint: true }) : [],
        tyreLife: Object.fromEntries(Object.entries(state.rules.tyres).map(([k, t]) => [k, round1(effectiveCliff(t, factor))])),
      });
    }
  }
  return {
    roundIndex: w.roundIndex,
    isCurrent,
    weather: revealedWeather(w, state.season.phase, isCurrent),
    forecast: w.forecast,
    parcFerme: w.parcFerme,
    teamOrders: w.teamOrders,
    penalties: w.penalties,
    drivers,
    practice: w.practice,
    sprintQualifying: w.sprintQualifying,
    sprint: w.sprint,
    qualifying: w.qualifying,
    race: w.race,
  };
}
