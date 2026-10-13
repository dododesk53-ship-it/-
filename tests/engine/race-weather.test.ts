import { describe, expect, it } from 'vitest';
import { createPreRaceRainWindow } from '../../src/engine/raceWeather';
import { Rng } from '../../src/engine/rng';

describe('赛前公开降雨窗口', () => {
  it('由隐藏轨迹加噪生成，且同一随机种子可复现', () => {
    const trajectory = [...Array(9).fill(0), ...Array(31).fill(0.7)];
    const first = createPreRaceRainWindow(trajectory, 0.72, 80, new Rng(123));
    const second = createPreRaceRainWindow(trajectory, 0.72, 80, new Rng(123));
    expect(first).toEqual(second);
    expect(first).not.toBeNull();
    expect(first![0]).toBeGreaterThanOrEqual(1);
    expect(first![1]).toBeLessThanOrEqual(trajectory.length);
    expect(first![0]).toBeLessThanOrEqual(first![1]);
  });

  it('允许无雨轨迹没有公开降雨窗口', () => {
    expect(createPreRaceRainWindow(Array(40).fill(0), 0, 95, new Rng(1))).toBeNull();
  });
});
