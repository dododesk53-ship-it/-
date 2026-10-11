<script setup lang="ts">
import { computed } from 'vue';
import Bar from '../components/Bar.vue';
import Kpi from '../components/Kpi.vue';
import { call, money, pct, store } from '../bridge';

const v = computed(() => store.view!);
const p = computed(() => v.value.player);
const team = computed(() => p.value.team);
const track = computed(() => v.value.round?.track ?? null);
const myDrivers = computed(() => v.value.drivers.filter(d => d.isPlayerTeam && d.slot !== null).sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0)));
const ranking = computed(() => [...v.value.teams].filter(t => t.trackScore !== null).sort((a, b) => (b.trackScore ?? 0) - (a.trackScore ?? 0)));
const capPct = computed(() => 1 - p.value.capRemaining / v.value.rules.costCap);
const demandLabels: Record<string, string> = { downforce: '下压力', efficiency: '气动效率', power: '动力', mechanical: '机械抓地' };

function tone(v: number, good = 60, bad = 35): 'ok' | 'warn' | 'bad' {
  return v >= good ? 'ok' : v >= bad ? 'warn' : 'bad';
}
</script>

<template>
  <div class="stack">
    <div class="grid g4">
      <Kpi label="车队积分榜" :value="`P${p.rank}`" :sub="`${p.points} 分 · 榜首 ${p.leaderPoints} 分`" />
      <Kpi label="资金" :value="money(team.funds)" :sub="`年薪支出 ${money(p.annualSalaries)}`" :tone="team.funds < 5 ? 'bad' : ''" />
      <Kpi label="预算帽剩余" :value="money(p.capRemaining)" :sub="`已用 ${pct(capPct)} / ${money(v.rules.costCap)}`" :tone="p.capRemaining < 10 ? 'warn' : ''" />
      <Kpi label="董事会信心" :value="Math.round(team.boardConfidence)" :sub="`目标：车队第 ${team.targetPosition}`" :tone="tone(team.boardConfidence)" />
      <Kpi label="媒体声誉" :value="Math.round(team.mediaReputation)" />
      <Kpi label="员工士气" :value="Math.round(team.staffMorale)" :tone="tone(team.staffMorale)" />
      <Kpi label="风洞/CFD 时长" :value="`${team.aeroHours}h`" sub="每站按排名刷新" />
      <Kpi label="研发槽位" :value="`${p.projects.filter(x => x.kind === 'design').length}/${p.rndSlots}`" sub="进行中的设计项目" />
    </div>

    <div class="grid g2">
      <div v-if="track" class="card stack-s">
        <h3>{{ v.round?.name }}</h3>
        <div class="small muted">
          {{ track.name }} · {{ track.type }} · {{ track.laps }} 圈 · 进站损失 {{ track.pitLoss }}s
          <template v-if="v.round?.dateLabel"> · {{ v.round.dateLabel }}</template>
        </div>
        <div v-if="track.description" class="small">{{ track.description }}</div>
        <Bar v-for="(w, k) in track.weights" :key="k" :label="demandLabels[k]" :value="w * 100" :digits="0" color="#6aa6ff" hint="赛道对该属性的需求权重(%)" />
        <Bar label="超车容易度" :value="track.overtaking" :digits="0" color="#9b7bff" />
        <Bar label="轮胎负荷" :value="track.tyreStress" :digits="0" color="#ffb347" />
        <div class="row small">
          <span class="badge">降雨概率 {{ pct(v.weekend?.isCurrent ? v.weekend.forecast.race : track.rainChance) }}</span>
          <span class="badge">安全车倾向 {{ pct(track.scChance) }}</span>
        </div>
      </div>

      <div class="card stack-s">
        <h3>本站赛车性能排名</h3>
        <div v-if="!ranking.length" class="empty">赛季已结束</div>
        <div v-for="(t, i) in ranking" :key="t.id" class="rank-row" :class="{ me: t.isPlayer }">
          <span class="mono muted">{{ i + 1 }}</span>
          <span class="swatch" :style="{ background: t.color }"></span>
          <span class="grow">{{ t.name }}</span>
          <Bar :value="t.trackScore ?? 0" :min="60" :max="100" :color="t.color" style="width: 55%" />
        </div>
        <div class="tiny muted">按赛道需求加权的赛车性能（取车队较快的那台车）。</div>
      </div>
    </div>

    <div class="grid g2">
      <div class="card stack-s">
        <h3>车手</h3>
        <div v-for="d in myDrivers" :key="d.id" class="driver-row">
          <div class="spread">
            <b>#{{ d.number }} {{ d.name }} <span v-if="d.isPriority" class="badge team">优先</span></b>
            <span class="small muted">车手榜 P{{ d.position ?? '-' }} · {{ d.points }} 分</span>
          </div>
          <div class="grid g3 tiny">
            <Bar label="综合" :value="d.overall" :mark="d.potential" hint="白线 = 潜力上限" />
            <Bar label="心态" :value="d.morale" :color="d.morale >= 60 ? 'var(--green)' : d.morale >= 35 ? 'var(--yellow)' : 'var(--red)'" />
            <Bar label="信任" :value="d.trust" color="#6aa6ff" />
          </div>
        </div>
      </div>

      <div class="card stack-s">
        <div class="spread">
          <h3>待 AI 叙述</h3>
          <button v-if="v.narration.length" class="small primary" :disabled="store.busy || !!store.status?.generating" @click="call(a => a.requestNarration())">让 AI 叙述</button>
        </div>
        <div v-if="!v.narration.length" class="tiny muted">暂无。模拟练习赛/排位/正赛、零件交付等事件会进入这里，下一条 AI 回复会把它们写进剧情。</div>
        <div v-for="e in v.narration" :key="e.id" class="small">
          <b>{{ e.title }}</b>
          <div class="muted tiny">{{ e.detail }}</div>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>新闻</h3>
      <div class="news scroll">
        <div v-for="n in v.news" :key="n.id" class="small news-item">
          <span class="badge">{{ n.tag }}</span>
          <span class="tiny muted mono">{{ n.at }}</span>
          {{ n.text }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rank-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 4px;
  border-radius: 6px;
}
.rank-row.me {
  background: color-mix(in srgb, var(--team) 16%, transparent);
}
.driver-row {
  padding: 8px;
  border-radius: 8px;
  background: var(--bg);
  border: 1px solid var(--line);
}
.news {
  max-height: 220px;
}
.news-item {
  padding: 4px 0;
  border-bottom: 1px dashed var(--line);
}
</style>
