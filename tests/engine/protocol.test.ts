import { describe, expect, it } from 'vitest';
import { applyAiCommands, describeLog, parseAiCommands, stripAiCommands } from '../../src/engine/protocol';
import { buildStatePrompt } from '../../src/engine/prompt';
import { advanceUntil, newTestGame } from '../helpers';

describe('AI 指令协议', () => {
  it('宽松解析：JSON 行、数组、单引号、尾逗号、中文 op', () => {
    const text = `正文……
<F1M_UPDATE>
{"op":"morale","driver":"c1","delta":3,"reason":"鼓励"},
{'op':'资金','delta':-1.5,'reason':'罚款'}
{op: "news", text: "车队宣布新赞助", tag: "商务"}
这一行不是 JSON
</F1M_UPDATE>
<F1M_UPDATE>[{"op":"trust","driver":"测试车手C2","delta":-2}]</F1M_UPDATE>`;
    const { commands, errors } = parseAiCommands(text);
    expect(commands.map(c => c.op)).toEqual(['morale', 'funds', 'news', 'trust']);
    expect(errors).toHaveLength(1);
    expect(stripAiCommands(text)).toBe('正文……');
  });

  it('白名单 + 幅度上限 + 累计上限', () => {
    const s = newTestGame();
    const m0 = s.drivers.c1.morale;
    const f0 = s.teams.team_c.funds;
    const logs = applyAiCommands(
      s,
      [
        { op: 'morale', driver: 'c1', delta: 8 },
        { op: 'morale', driver: 'c1', delta: 8 }, // 累计超过 ±10 → 只给 +2
        { op: 'funds', delta: 50 }, // 超过 ±3M
        { op: 'car_perf', delta: 20 }, // 不在白名单
        { op: 'trust', driver: 'a1', delta: 5 }, // 非本队车手不能改信任
        { op: 'penalty', driver: 'a1', grid: 9 }, // 罚退上限 5
        { op: 'flag', key: 'fired', value: true }, // 受保护
      ],
      { messageId: 7 },
    );
    expect(s.drivers.c1.morale).toBeCloseTo(Math.min(100, m0 + 10), 1);
    expect(s.teams.team_c.funds).toBeCloseTo(f0 + 3, 2);
    expect(logs.find(l => l.op === 'car_perf')!.ok).toBe(false);
    expect(logs.find(l => l.op === 'trust')!.ok).toBe(false);
    expect(logs.find(l => l.op === 'penalty')!.applied).toBe(5);
    expect(logs.find(l => l.op === 'flag')!.ok).toBe(false);
    expect(s.aiLog.length).toBe(7);
    expect(describeLog(s, logs[0])).toContain('心态');
  });

  it('单条消息指令数上限', () => {
    const s = newTestGame();
    const cmds = Array.from({ length: 12 }, () => ({ op: 'media', delta: 0.5 }));
    const logs = applyAiCommands(s, cmds, { messageId: 1 });
    expect(logs.filter(l => l.ok)).toHaveLength(s.rules.aiLimits.maxCommands);
  });

  it('排位前的罚退本站生效，之后的进入下一站', () => {
    let s = advanceUntil(newTestGame(12), x => x.season.phase === 'practice');
    applyAiCommands(s, [{ op: 'penalty', driver: 'c1', grid: 3 }], { messageId: 1 });
    expect(s.weekend!.penalties.c1).toBe(3);
    s = advanceUntil(s, x => x.season.phase === 'post_race');
    applyAiCommands(s, [{ op: 'penalty', driver: 'c2', grid: 2 }], { messageId: 2 });
    expect(JSON.parse(String(s.flags.pendingPenalties)).c2).toBe(2);
  });
});

describe('提示词', () => {
  it('包含关键事实、车手 id 与待叙述事件，且长度可控', () => {
    const s = advanceUntil(newTestGame(3), x => x.season.phase === 'race');
    const p = buildStatePrompt(s);
    expect(p).toContain('测试车队C');
    expect(p).toContain('id:c1');
    expect(p).toContain('待叙述事件');
    expect(p).toContain('F1M_UPDATE');
    expect(p).toContain('排位');
    expect(p.length).toBeLessThan(4000);
  });

  it('正赛前不会泄露正赛天气', () => {
    const s = advanceUntil(newTestGame(3), x => x.season.phase === 'practice');
    const p = buildStatePrompt(s);
    expect(p).toMatch(/正赛降雨概率 \d+%/);
  });
});
