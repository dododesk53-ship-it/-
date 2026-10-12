import { describe, expect, it } from 'vitest';
import { act, advanceUntil, newTestGame, tryAct } from '../helpers';
import { buildView } from '../../src/engine/view';
import { buildStatePrompt } from '../../src/engine/prompt';
import { Rng } from '../../src/engine/rng';
import { createForecast } from '../../src/engine/raceWeather';

describe('resumable live race', () => {
  function raceReady(seed = 702): ReturnType<typeof newTestGame> {
    let state = newTestGame(seed);
    state = advanceUntil(state, s => s.season.phase === 'race');
    return state;
  }

  it('creates a JSON-safe grid checkpoint and hides private simulation inputs from the view', () => {
    const state = act(raceReady(), { type: 'START_RACE', kind: 'race' });
    const restored = JSON.parse(JSON.stringify(state));
    const live = restored.weekend.liveRace;
    expect(live.pendingDecision?.reasons).toEqual(['grid']);
    expect(live.weatherTrajectory).toHaveLength(live.totalLaps);
    const publicRace = buildView(restored).weekend?.liveRace;
    expect(publicRace?.weather.forecast.horizonLaps).toBe(5);
    expect(JSON.stringify(publicRace)).not.toContain('weatherTrajectory');
    expect(JSON.stringify(publicRace)).not.toContain('rngState');
    expect(JSON.stringify(publicRace)).not.toContain('plannedCompounds');
    const prompt = buildStatePrompt(restored);
    expect(prompt).toContain('实时比赛');
    expect(prompt).not.toContain('weatherTrajectory');
    expect(prompt).not.toContain(String(live.rngState));
  });

  it('rejects stale windows atomically and accepts a two-car grid decision', () => {
    const started = act(raceReady(), { type: 'START_RACE', kind: 'race' });
    const live = started.weekend!.liveRace!;
    const playerIds = Object.values(live.cars).filter(c => c.player).map(c => c.driverId);
    const stale = tryAct(started, { type: 'RESOLVE_RACE_DECISION', sessionId: live.id, expectedRevision: live.revision + 1, windowId: live.pendingDecision!.id, drivers: [] });
    expect(stale.ok).toBe(false);
    expect(stale.state).toBe(started);
    const resolved = act(started, {
      type: 'RESOLVE_RACE_DECISION', sessionId: live.id, expectedRevision: live.revision, windowId: live.pendingDecision!.id,
      drivers: playerIds.map(driverId => ({ driverId, pit: 'auto' })),
    });
    expect(resolved.weekend!.liveRace?.pendingDecision).toBeNull();
    expect(resolved.weekend!.liveRace?.revision).toBeGreaterThan(live.revision);
  });

  it('matches automatic completion when every interactive window delegates to auto', () => {
    const ready = raceReady(991);
    const automatic = act(ready, { type: 'RUN_RACE' });
    let interactive = act(ready, { type: 'START_RACE', kind: 'race' });
    for (let i = 0; i < 200 && interactive.weekend?.liveRace; i++) {
      const live = interactive.weekend.liveRace;
      if (live.pendingDecision) {
        interactive = act(interactive, {
          type: 'RESOLVE_RACE_DECISION', sessionId: live.id, expectedRevision: live.revision, windowId: live.pendingDecision.id,
          drivers: Object.values(live.cars).filter(c => c.player && c.status === 'running').map(c => ({ driverId: c.driverId, pit: 'auto' })),
        });
      } else {
        interactive = act(interactive, { type: 'ADVANCE_RACE', sessionId: live.id, expectedRevision: live.revision, until: 'next_decision' });
      }
    }
    expect(interactive.weekend?.liveRace).toBeNull();
    expect(interactive.weekend?.race?.classification).toEqual(automatic.weekend?.race?.classification);
  });

  it('continues with one player retirement and only accepts running eligible choices', () => {
    const started = act(raceReady(), { type: 'START_RACE', kind: 'race' });
    const live = started.weekend!.liveRace!;
    const retired = Object.values(live.cars).find(c => c.player)!;
    retired.status = 'dnf'; retired.reason = 'test';
    const running = Object.values(live.cars).find(c => c.player && c.status === 'running')!;
    const result = act(started, { type: 'RESOLVE_RACE_DECISION', sessionId: live.id, expectedRevision: live.revision, windowId: live.pendingDecision!.id, drivers: [{ driverId: running.driverId, pit: 'auto' }] });
    expect(result.weekend!.liveRace?.pendingDecision).toBeNull();
    expect(result.weekend!.liveRace?.cars[retired.driverId].status).toBe('dnf');
  });

  it('does not change tyre without a valid box choice and rejects invalid option values', () => {
    const started = act(raceReady(), { type: 'START_RACE', kind: 'race' });
    const live = started.weekend!.liveRace!;
    const car = Object.values(live.cars).find(c => c.player)!;
    const before = car.tyre;
    const invalid = tryAct(started, { type: 'RESOLVE_RACE_DECISION', sessionId: live.id, expectedRevision: live.revision, windowId: live.pendingDecision!.id, drivers: [{ driverId: car.driverId, pit: 'auto', compound: 'W' }] });
    expect(invalid.ok).toBe(false);
    expect(started.weekend!.liveRace!.cars[car.driverId].tyre).toBe(before);
    const badMode = tryAct(started, { type: 'RESOLVE_RACE_DECISION', sessionId: live.id, expectedRevision: live.revision, windowId: live.pendingDecision!.id, drivers: [{ driverId: car.driverId, pit: 'auto', paceMode: 'warp' as never }] });
    expect(badMode.ok).toBe(false);
  });

  it('keeps forecast uncertainty independent from the hidden five-lap weather path', () => {
    const dry = [0, 0, 0, 0, 0];
    const forecasts = Array.from({ length: 16 }, (_, i) => createForecast(dry, 0, 0, new Rng(i + 1)));
    expect(forecasts.some(f => f.arrivalLaps !== null)).toBe(true);
    expect(forecasts.some(f => f.rainProbability > 0)).toBe(true);
  });

  it('restores an exact zero RNG state', () => {
    const rng = Rng.restore(0);
    expect(rng.state).toBe(0);
    rng.next();
    expect(rng.state).not.toBe(0);
  });
});
