<script setup lang="ts">
import { computed, ref } from 'vue';
import Bar from '../components/Bar.vue';
import LapChart from '../components/LapChart.vue';
import Tyre from '../components/Tyre.vue';
import LiveRaceDesk from '../components/LiveRaceDesk.vue';
import { act, call, lapTime, pct, store } from '../bridge';
import type { DriverPlan, PaceMode, PitTiming, PracticeProgram, QualiApproach, RaceResult, QualiResult } from '../../../engine/types';
import type { WeekendDriverView } from '../../../engine/view';

const v = computed(() => store.view!);
const w = computed(() => v.value.weekend);
const phase = computed(() => v.value.season.phase);
const isSprint = computed(() => !!v.value.round?.sprint);
const current = computed(() => !!w.value?.isCurrent);
const generating = computed(() => !!store.status?.generating);

const steps = computed(() => {
  const s: Array<{ id: string; label: string }> = [{ id: 'practice', label: '练习赛' }];
  if (isSprint.value) s.push({ id: 'sprint_qualifying', label: '冲刺排位' }, { id: 'sprint', label: '冲刺赛' });
  s.push({ id: 'qualifying', label: '排位赛' }, { id: 'race', label: '正赛' }, { id: 'post_race', label: '赛后' });
  return s;
});
const stepIndex = computed(() => (current.value ? steps.value.findIndex(s => s.id === phase.value) : -1));

const done = computed(() => ({
  practice: !!w.value?.practice,
  sprintQualifying: !!w.value?.sprintQualifying,
  sprint: !!w.value?.sprint,
  qualifying: !!w.value?.qualifying,
  race: !!w.value?.race,
}));

const resultTab = ref<'race' | 'qualifying' | 'sprint' | 'sprintQualifying' | 'practice'>('race');
const shownResult = computed(() => {
  const ww = w.value;
  if (!ww) return null;
  const order: Array<typeof resultTab.value> = [resultTab.value, 'race', 'qualifying', 'sprint', 'sprintQualifying', 'practice'];
  for (const k of order) if (ww[k]) return k;
  return null;
});

function setPlan(d: WeekendDriverView, patch: Partial<DriverPlan>) {
  return act({ type: 'SET_PLAN', driverId: d.driverId, plan: patch }, { silent: true });
}

function planIs(d: WeekendDriverView, compounds: string[]): boolean {
  return Array.isArray(d.plan.tyrePlan) && d.plan.tyrePlan.join('-') === compounds.join('-');
}

function name(id: string): string {
  return v.value.drivers.find(d => d.id === id)?.name ?? id;
}
function teamOf(id: string) {
  const d = v.value.drivers.find(x => x.id === id);
  return { color: d?.teamColor ?? '#666', mine: !!d?.isPlayerTeam };
}

const programs: Array<[PracticeProgram, string, string]> = [
  ['setup', '调校', '提升调校信心（排位与正赛都更快）'],
  ['longrun', '长距离', '积累轮胎数据（降低衰减、策略更准）'],
  ['quali_sim', '排位模拟', '直接提升排位单圈'],
  ['parts', '新件测试', '验证新零件的真实性能，发现问题可在排位前换回旧件'],
];
const approaches: Array<[QualiApproach, string, string]> = [
  ['safe', '稳妥', '失误少，略慢'],
  ['standard', '标准', ''],
  ['aggressive', '激进', '更快，但失误率接近翻倍'],
];
const paceModes: Array<[PaceMode, string, string]> = [
  ['conserve', '保守', '慢约 0.3s/圈，多回收电能，轮胎与机械更耐用'],
  ['balanced', '均衡', ''],
  ['push', '进攻', '快约 0.2s/圈，并用 Boost 按钮主动释放电能（超车、防守更强），衰减与故障/失误风险上升'],
];
const timings: Array<[PitTiming, string, string]> = [
  ['early', '提前', '每段提前 2 圈进站（Undercut）'],
  ['standard', '按计划', ''],
  ['late', '推迟', '每段推迟 2 圈进站（Overcut）'],
];

const raceLike = computed<RaceResult | null>(() => {
  const k = shownResult.value;
  if (k === 'race') return w.value!.race;
  if (k === 'sprint') return w.value!.sprint;
  return null;
});
const qualiLike = computed<QualiResult | null>(() => {
  const k = shownResult.value;
  if (k === 'qualifying') return w.value!.qualifying;
  if (k === 'sprintQualifying') return w.value!.sprintQualifying;
  return null;
});
const chartSeries = computed(() => {
  const r = raceLike.value;
  if (!r) return [];
  const palette = ['var(--team)', '#ffffff', '#ffd400'];
  return Object.entries(r.lapChart).map(([id, data], i) => ({ name: name(id), color: palette[i % palette.length], data }));
});
const weatherText = (x: string | null, forecast?: number) => (x ? v.value.labels.weather[x as 'dry' | 'wet'] : forecast !== undefined ? `预报降雨 ${pct(forecast)}` : '未知');
</script>

<template>
  <div class="stack">
    <LiveRaceDesk v-if="current && w && ['race', 'sprint'].includes(phase)" />
    <div class="card">
      <div class="stepper">
        <div v-for="(s, i) in steps" :key="s.id" class="step" :class="{ done: stepIndex > i || (!current && !!w), on: stepIndex === i }">
          <span class="dot">{{ i + 1 }}</span>{{ s.label }}
        </div>
      </div>
      <div class="spread" style="margin-top: 10px">
        <div class="small muted">
          <template v-if="current && w">
            天气：练习 {{ weatherText(w.weather.practice) }} ·
            <template v-if="isSprint">冲刺排位 {{ weatherText(w.weather.sprintQualifying, w.forecast.qualifying) }} · 冲刺赛 {{ weatherText(w.weather.sprint, w.forecast.race) }} · </template>
            排位 {{ weatherText(w.weather.qualifying, w.forecast.qualifying) }} · 正赛 {{ weatherText(w.weather.race, w.forecast.race) }}
          </template>
          <template v-else-if="phase === 'pre_race' || phase === 'preseason'">还没进入本站比赛周末。工厂周可以先安排研发、装件和训练。</template>
          <template v-else-if="phase === 'season_end'">赛季已结束。</template>
        </div>
        <div class="row">
          <button v-if="v.narration.length" class="small" :disabled="generating" @click="call(a => a.requestNarration())">让 AI 叙述（{{ v.narration.length }}）</button>
          <button v-if="v.next" class="primary" :disabled="store.busy || generating" @click="act({ type: 'ADVANCE' })">▶ {{ v.next.label }}</button>
        </div>
      </div>
    </div>

    <template v-if="current && w">
      <div class="card stack-s">
        <h3>车队指令</h3>
        <div class="row">
          <div class="seg">
            <button :class="{ on: w.teamOrders.mode === 'free' }" :disabled="done.race" @click="act({ type: 'SET_TEAM_ORDERS', orders: { mode: 'free', favorDriverId: null } })">自由比赛</button>
            <button :class="{ on: w.teamOrders.mode === 'hold' }" :disabled="done.race" @click="act({ type: 'SET_TEAM_ORDERS', orders: { mode: 'hold', favorDriverId: null } })">保持位置</button>
            <button v-for="d in w.drivers" :key="d.driverId" :class="{ on: w.teamOrders.mode === 'favor' && w.teamOrders.favorDriverId === d.driverId }" :disabled="done.race" @click="act({ type: 'SET_TEAM_ORDERS', orders: { mode: 'favor', favorDriverId: d.driverId } })">
              偏向 {{ d.driverName }}
            </button>
          </div>
        </div>
        <div class="tiny muted">「偏向」时，若被偏向的车手紧跟在队友身后，队友会被要求让车——是否服从取决于他的自尊心与对你的信任；无论服从还是抗命，都会影响心态和车库气氛。</div>
      </div>

      <div class="grid g2">
        <div v-for="d in w.drivers" :key="d.driverId" class="card stack-s">
          <h3>{{ d.driverName }}</h3>
          <div class="grid" style="grid-template-columns: 1fr 1fr; gap: 4px 12px">
            <Bar label="调校信心" :value="d.setup.confidence" color="#6aa6ff" />
            <Bar label="轮胎数据" :value="d.setup.tyreKnowledge" color="#ffb347" />
          </div>
          <div v-if="w.penalties[d.driverId]" class="notice warn tiny">本站罚退 {{ w.penalties[d.driverId] }} 格</div>

          <div class="block">
            <div class="label">练习赛项目</div>
            <div class="seg wrap">
              <button v-for="[k, label, tip] in programs" :key="k" :title="tip" :class="{ on: d.plan.practiceProgram === k }" :disabled="done.practice || store.busy" @click="setPlan(d, { practiceProgram: k })">{{ label }}</button>
            </div>
          </div>
          <div class="block">
            <div class="label">排位方案</div>
            <div class="seg">
              <button v-for="[k, label, tip] in approaches" :key="k" :title="tip" :class="{ on: d.plan.qualiApproach === k }" :disabled="done.qualifying || store.busy" @click="setPlan(d, { qualiApproach: k })">{{ label }}</button>
            </div>
          </div>
          <div v-if="isSprint && d.sprintOptions.length" class="block">
            <div class="label">冲刺赛轮胎</div>
            <div class="seg">
              <button :class="{ on: d.plan.sprintTyre === 'auto' }" :disabled="done.sprint || store.busy" @click="setPlan(d, { sprintTyre: 'auto' })">自动</button>
              <button v-for="o in d.sprintOptions" :key="o.id" :class="{ on: d.plan.sprintTyre === o.compounds[0] }" :disabled="done.sprint || store.busy" @click="setPlan(d, { sprintTyre: o.compounds[0] })">
                <Tyre :c="o.compounds[0]" /> {{ o.delta > 0 ? `+${o.delta}s` : '最快' }}
              </button>
            </div>
          </div>
          <div class="block">
            <div class="label">正赛轮胎策略 <span class="tiny muted">（预测为干地；下雨时策略组会自动换雨胎）</span></div>
            <div class="plans">
              <label class="plan" :class="{ on: d.plan.tyrePlan === 'auto' }">
                <input type="radio" :checked="d.plan.tyrePlan === 'auto'" :disabled="done.race || store.busy" @change="setPlan(d, { tyrePlan: 'auto' })" />
                <span class="grow">交给策略组（自动选择最优）</span>
              </label>
              <label v-for="o in d.options" :key="o.id" class="plan" :class="{ on: planIs(d, o.compounds) }">
                <input type="radio" :checked="planIs(d, o.compounds)" :disabled="done.race || store.busy" @change="setPlan(d, { tyrePlan: o.compounds })" />
                <span class="row grow" style="gap: 4px">
                  <Tyre v-for="(c, i) in o.compounds" :key="i" :c="c" />
                  <span class="small">{{ o.stops }} 停</span>
                  <span class="tiny muted">分段 {{ o.stints.join('/') }} 圈</span>
                </span>
                <span class="mono small" :class="o.delta === 0 ? 'pos' : 'muted'">{{ o.delta === 0 ? '最优' : `+${o.delta}s` }}</span>
              </label>
            </div>
            <div class="tiny muted row">
              轮胎寿命（悬崖圈数）：
              <span v-for="(life, c) in d.tyreLife" :key="c" class="row" style="gap: 3px"><Tyre :c="String(c)" />{{ life }}</span>
            </div>
          </div>
          <div class="block row">
            <div>
              <div class="label">驾驶模式</div>
              <div class="seg">
                <button v-for="[k, label, tip] in paceModes" :key="k" :title="tip" :class="{ on: d.plan.paceMode === k }" :disabled="done.race || store.busy" @click="setPlan(d, { paceMode: k })">{{ label }}</button>
              </div>
            </div>
            <div>
              <div class="label">进站时机</div>
              <div class="seg">
                <button v-for="[k, label, tip] in timings" :key="k" :title="tip" :class="{ on: d.plan.pitTiming === k }" :disabled="done.race || store.busy" @click="setPlan(d, { pitTiming: k })">{{ label }}</button>
              </div>
            </div>
            <label class="row small" title="出现安全车/VSC 时，若轮胎已用过半则趁机进站">
              <input type="checkbox" :checked="d.plan.scReaction" :disabled="done.race || store.busy" @change="setPlan(d, { scReaction: ($event.target as HTMLInputElement).checked })" />
              安全车时机会进站
            </label>
          </div>
        </div>
      </div>
    </template>

    <div v-if="w && shownResult" class="card stack-s">
      <div class="spread">
        <h3>{{ current ? '本站' : '上一站' }}成绩</h3>
        <div class="seg">
          <button v-if="w.practice" :class="{ on: shownResult === 'practice' }" @click="resultTab = 'practice'">练习</button>
          <button v-if="w.sprintQualifying" :class="{ on: shownResult === 'sprintQualifying' }" @click="resultTab = 'sprintQualifying'">冲刺排位</button>
          <button v-if="w.sprint" :class="{ on: shownResult === 'sprint' }" @click="resultTab = 'sprint'">冲刺赛</button>
          <button v-if="w.qualifying" :class="{ on: shownResult === 'qualifying' }" @click="resultTab = 'qualifying'">排位</button>
          <button v-if="w.race" :class="{ on: shownResult === 'race' }" @click="resultTab = 'race'">正赛</button>
        </div>
      </div>

      <div v-if="shownResult === 'practice' && w.practice" class="table-wrap">
        <table>
          <thead><tr><th>#</th><th>车手</th><th>圈速</th><th>圈数</th><th>项目收益</th></tr></thead>
          <tbody>
            <tr v-for="(e, i) in w.practice.timesheet" :key="e.driverId" :class="{ me: teamOf(e.driverId).mine }">
              <td class="mono">{{ i + 1 }}</td>
              <td><span class="swatch" :style="{ background: teamOf(e.driverId).color }"></span>{{ name(e.driverId) }}</td>
              <td class="mono">{{ lapTime(e.time) }}</td>
              <td class="mono">{{ e.laps }}</td>
              <td class="tiny">
                <template v-if="teamOf(e.driverId).mine && w.practice.gains[e.driverId]">
                  调校 +{{ w.practice.gains[e.driverId].setup }} · 轮胎 +{{ w.practice.gains[e.driverId].tyre }}
                  <template v-if="w.practice.gains[e.driverId].verified.length"> · 验证 {{ w.practice.gains[e.driverId].verified.join('、') }}</template>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <template v-if="qualiLike">
        <div class="small muted">{{ qualiLike.weather === 'wet' ? '雨地' : '干地' }} · 杆位 {{ qualiLike.pole ? `${name(qualiLike.pole.driverId)} ${lapTime(qualiLike.pole.time)}` : '—' }}</div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>发车</th><th>车手</th><th v-for="s in qualiLike.sessions" :key="s.name">{{ s.name }}</th></tr>
            </thead>
            <tbody>
              <tr v-for="(id, i) in qualiLike.grid" :key="id" :class="{ me: teamOf(id).mine }">
                <td class="mono">{{ i + 1 }}<span v-if="qualiLike.order.indexOf(id) !== i" class="tiny muted">（排位 {{ qualiLike.order.indexOf(id) + 1 }}）</span></td>
                <td><span class="swatch" :style="{ background: teamOf(id).color }"></span>{{ name(id) }}</td>
                <td v-for="s in qualiLike.sessions" :key="s.name" class="mono">
                  <template v-for="e in s.entries.filter(x => x.driverId === id)" :key="e.driverId">
                    {{ e.time ? lapTime(e.time) : e.note ?? '无成绩' }}<span v-if="e.eliminated" class="neg tiny"> ✗</span>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-for="(e, i) in qualiLike.events" :key="i" class="tiny">· {{ e.text }}</div>
      </template>

      <template v-if="raceLike">
        <div class="small muted">
          {{ raceLike.weather === 'wet' ? '雨战' : '干地' }} · {{ raceLike.laps }} 圈 · 安全车 {{ raceLike.safetyCars }} 次
          <template v-if="raceLike.fastestLap"> · 最快圈 {{ name(raceLike.fastestLap.driverId) }} {{ lapTime(raceLike.fastestLap.time) }}</template>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>名次</th><th>车手</th><th>发车</th><th>差距</th><th>进站</th><th>轮胎</th><th>最快圈</th><th>积分</th></tr></thead>
            <tbody>
              <tr v-for="c in raceLike.classification" :key="c.driverId" :class="{ me: teamOf(c.driverId).mine }">
                <td class="mono">{{ c.pos ?? 'DNF' }}</td>
                <td><span class="swatch" :style="{ background: teamOf(c.driverId).color }"></span>{{ name(c.driverId) }}</td>
                <td class="mono">{{ c.grid }}<span v-if="c.pos" class="tiny" :class="c.grid - c.pos > 0 ? 'pos' : c.grid - c.pos < 0 ? 'neg' : 'muted'">（{{ c.grid - c.pos > 0 ? '+' : '' }}{{ c.grid - c.pos }}）</span></td>
                <td class="mono">{{ c.status === 'dnf' ? c.reason : c.gap }}</td>
                <td class="mono">{{ c.pits }}</td>
                <td><span class="row" style="gap: 2px"><Tyre v-for="(t, i) in c.tyres" :key="i" :c="t" /></span></td>
                <td class="mono">{{ lapTime(c.bestLap) }}</td>
                <td class="mono">{{ c.points || '' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <LapChart v-if="chartSeries.length" :series="chartSeries" :max-pos="raceLike.classification.length" />
        <details open>
          <summary class="small muted">比赛事件（{{ raceLike.events.length }}）</summary>
          <div class="events scroll">
            <div v-for="(e, i) in raceLike.events" :key="i" class="tiny" :class="{ key: e.key }">
              <span class="mono muted">L{{ e.lap }}</span> {{ e.text }}
            </div>
          </div>
        </details>
      </template>
    </div>
  </div>
</template>

<style scoped>
.stepper {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.step {
  flex: 1;
  min-width: 80px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--bg);
  border: 1px solid var(--line);
  color: var(--muted);
  font-size: 12px;
}
.step .dot {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--bg3);
  font-size: 11px;
}
.step.done {
  color: var(--text);
}
.step.done .dot {
  background: var(--green);
  color: #000;
}
.step.on {
  border-color: var(--team);
  color: var(--text);
  font-weight: 600;
}
.step.on .dot {
  background: var(--team);
  color: #fff;
}
.block {
  border-top: 1px dashed var(--line);
  padding-top: 8px;
}
.label {
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 4px;
}
.seg.wrap {
  flex-wrap: wrap;
}
.plans {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-bottom: 4px;
}
.plan {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: var(--bg);
  cursor: pointer;
}
.plan.on {
  border-color: var(--team);
}
.plan input {
  accent-color: var(--team);
}
.events {
  max-height: 260px;
  margin-top: 6px;
}
.events .key {
  color: var(--text);
}
.events div {
  color: var(--muted);
  padding: 1px 0;
}
</style>
