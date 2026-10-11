/**
 * 开局：由数据库构建初始存档。
 */
import { seedFrom } from './rng';
import type {
  CarState,
  Database,
  Difficulty,
  DriverState,
  GameState,
  PartType,
  Randomness,
  Standings,
  TeamParts,
  TeamState,
} from './types';
import { deepClone, round1 } from './util';
import { aeroAllowance } from './development';

export interface NewGameOptions {
  playerTeamId: string;
  principalName: string;
  difficulty?: Difficulty;
  randomness?: Randomness;
  seed?: number;
  gameId?: string;
  now?: number;
}

export function emptyDriverStanding(rounds: number) {
  return {
    points: 0,
    wins: 0,
    podiums: 0,
    poles: 0,
    fastestLaps: 0,
    dnfs: 0,
    best: null,
    results: new Array(rounds).fill(null),
    sprintPoints: 0,
  };
}

export function emptyStandings(state: Pick<GameState, 'drivers' | 'teamOrder' | 'calendar'>): Standings {
  const rounds = state.calendar.length;
  const standings: Standings = { drivers: {}, teams: {} };
  for (const d of Object.values(state.drivers)) {
    if (d.teamId) standings.drivers[d.id] = emptyDriverStanding(rounds);
  }
  for (const tid of state.teamOrder) standings.teams[tid] = { points: 0, wins: 0, podiums: 0, best: null };
  return standings;
}

export function createGame(db: Database, opts: NewGameOptions): GameState {
  const now = opts.now ?? Date.now();
  const gameId = opts.gameId ?? `g${now.toString(36)}`;
  if (!db.teams.some(t => t.id === opts.playerTeamId)) {
    throw new Error(`找不到车队「${opts.playerTeamId}」`);
  }
  const rules = deepClone(db.rules);
  const teams: Record<string, TeamState> = {};
  const teamOrder = db.teams.map(t => t.id);

  // 按董事会预期排名估算初始风洞时长
  const expectedRank = [...db.teams].sort((a, b) => a.targetPosition - b.targetPosition).map(t => t.id);

  for (const def of db.teams) {
    const parts: Record<PartType, TeamParts> = {};
    const fitted: Record<PartType, string> = {};
    for (const pt of Object.keys(rules.parts)) {
      const p = def.parts[pt] ?? { perf: 70, rel: 80 };
      const specId = `${pt}-1`;
      parts[pt] = {
        specs: [
          { id: specId, type: pt, version: 1, perf: round1(p.perf), rel: round1(p.rel), verified: true, expected: null, introduced: '初始' },
        ],
        stock: { [specId]: pt === 'front_wing' ? 2 : 1 },
      };
      fitted[pt] = specId;
    }
    const raceDrivers = db.drivers.filter(d => d.teamId === def.id && d.role === 'race');
    const cars: CarState[] = raceDrivers.map((d, i) => ({ slot: i + 1, driverId: d.id, fitted: { ...fitted } }));
    const isPlayer = def.id === opts.playerTeamId;
    teams[def.id] = {
      id: def.id,
      name: def.name,
      short: def.short,
      color: def.color,
      principal: isPlayer ? opts.principalName : def.principal,
      engine: def.engine,
      base: def.base,
      isPlayer,
      funds: def.funds,
      costCapSpent: 0,
      sponsorIncome: def.sponsorIncome,
      operatingCost: def.operatingCost,
      facilities: { ...def.facilities },
      staff: deepClone(def.staff),
      parts,
      cars,
      projects: [],
      aeroHours: aeroAllowance(rules, expectedRank.indexOf(def.id)),
      driverPriority: null,
      boardConfidence: 60,
      targetPosition: def.targetPosition,
      mediaReputation: 50,
      staffMorale: 65,
      nextSeasonFocus: isPlayer ? 0 : 10,
      description: def.description,
    };
  }

  const drivers: Record<string, DriverState> = {};
  for (const d of db.drivers) {
    drivers[d.id] = {
      ...deepClone(d),
      trust: d.teamId === opts.playerTeamId ? 55 : 50,
      form: 0,
      stats: { starts: 0, wins: 0, podiums: 0, poles: 0, points: 0, dnfs: 0 },
    };
  }

  const state: GameState = {
    schema: 1,
    gameId,
    meta: {
      createdAt: now,
      playerTeamId: opts.playerTeamId,
      principalName: opts.principalName || '领队',
      difficulty: opts.difficulty ?? 'normal',
      randomness: opts.randomness ?? 'deterministic',
      dataSignature: db.signature,
      dataSources: [...db.sources],
    },
    rng: opts.seed ?? seedFrom(`${gameId}:${db.signature}`),
    seq: 0,
    rules,
    tracks: Object.fromEntries(db.tracks.map(t => [t.id, deepClone(t)])),
    calendar: deepClone(db.calendar),
    season: { year: rules.seasonYear, number: 1, roundIndex: 0, phase: 'preseason', week: 0 },
    teams,
    teamOrder,
    drivers,
    standings: { drivers: {}, teams: {} },
    weekend: null,
    history: [],
    news: [],
    narration: [],
    narrated: [],
    flags: {},
    aiLog: [],
    lastSeason: null,
  };
  state.standings = emptyStandings(state);

  const team = teams[opts.playerTeamId];
  const firstTrack = state.tracks[state.calendar[0]?.trackId]?.name ?? '首站';
  state.news.push({
    id: 'n0',
    at: 'S1R1',
    tag: '车队',
    text: `${state.meta.principalName} 正式出任 ${team.name} 领队，${state.season.year} 赛季季前准备开始。`,
  });
  state.narration.push({
    id: 'e0',
    at: 'S1R1',
    kind: 'new_game',
    title: '就任领队',
    detail: `${state.meta.principalName} 刚刚正式出任 ${team.name} 的车队领队。距离首站（${firstTrack}）还有 ${state.calendar[0]?.weeksGap ?? 0} 周。董事会对本赛季的目标是车队积分榜第 ${team.targetPosition} 名。`,
  });
  return state;
}
