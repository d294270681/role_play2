<script setup>
import { computed } from "vue";

import { currentLocation, game, locationDanger } from "../store.js";
import { currentPeriod, dangerClass, dangerWord, isNight } from "../util.js";

const period = computed(() => currentPeriod(game.state));
const loc = computed(() => currentLocation());
const danger = computed(() => locationDanger(loc.value));
const night = computed(() => isNight(period.value));

const gauges = computed(() => {
  const g = game.state?.character?.gauges || {};
  return [
    { name: "生命", g: g.生命, kind: "is-life" },
    { name: "精力", g: g.精力, kind: "is-energy" },
    { name: "压力", g: g.压力, kind: "is-stress" },
  ].filter((x) => x.g);
});

function pct(g) {
  const max = Number(g?.max) || 0;
  const val = Number(g?.value) || 0;
  return max > 0 ? `${Math.max(0, Math.min(100, (val / max) * 100))}%` : "0%";
}

function text(g) {
  return `${Number(g?.value) || 0} / ${Number(g?.max) || 0}`;
}
</script>

<template>
  <header class="topbar">
    <div class="brand">
      <span class="sigil">✦</span>
      <div class="brand-text">
        <div class="title">{{ game.moduleInfo?.title || game.module || "文字冒险" }}</div>
        <div class="subtitle">{{ game.moduleInfo?.rating || "" }}<template v-if="game.moduleInfo?.tone"> · {{ game.moduleInfo.tone }}</template></div>
      </div>
    </div>

    <div class="stamp">
      <span class="day">第 {{ game.state?.day ?? 1 }} 天</span>
      <span class="mid">·</span>
      <span class="period" :class="{ night }">{{ period || "—" }}</span>
      <span class="mid">·</span>
      <span class="loc">{{ game.state?.location || "未知地点" }}</span>
      <span v-if="loc" class="danger" :class="dangerClass(danger)" :title="`有效危险度 ${danger}（${dangerWord(danger)}）`">
        危险度 {{ danger }}
      </span>
      <span v-else class="danger muted">不在本册地图</span>
    </div>

    <div class="vitals">
      <div v-for="row in gauges" :key="row.name" class="vital">
        <span class="vital-name">{{ row.name }}</span>
        <div class="gauge-rail">
          <div class="gauge-fill" :class="row.kind" :style="{ width: pct(row.g) }" />
        </div>
        <span class="vital-text">{{ text(row.g) }}</span>
      </div>
    </div>

    <div class="actions">
      <button class="model-btn" :title="game.config?.configured ? game.config.base_url : '配置文字大模型 API'" @click="game.settingsOpen = true">{{ game.config?.configured ? `模型：${game.config.model}` : game.config?.llm_mode === 'demo' ? '演示模式' : '配置大模型 API' }}</button>
      <button class="icon-btn" title="收起/展开左栏" @click="game.leftCollapsed = !game.leftCollapsed">◧</button>
      <button class="icon-btn" title="收起/展开右栏" @click="game.rightCollapsed = !game.rightCollapsed">◨</button>
      <button class="icon-btn" title="设置" aria-label="设置" @click="game.settingsOpen = true">⚙</button>
    </div>
  </header>
</template>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  gap: 22px;
  height: 58px;
  padding: 0 16px;
  border-bottom: 1px solid var(--line-soft);
  background: linear-gradient(180deg, #141a22, #10141a);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.02);
  flex-shrink: 0;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.sigil {
  color: var(--brass);
  font-size: 19px;
  text-shadow: 0 0 12px rgba(212, 169, 74, 0.5);
}
.brand-text { min-width: 0; }
.title {
  font-family: var(--serif);
  font-size: 16px;
  letter-spacing: 0.06em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.subtitle {
  font-size: 11px;
  color: var(--text-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 260px;
}

.stamp {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  color: var(--text-dim);
  white-space: nowrap;
}
.stamp .day { color: var(--text); font-weight: 600; }
.stamp .mid { color: var(--text-faint); }
.stamp .period { color: var(--brass); }
.stamp .period.night { color: var(--violet); }
.stamp .loc { color: var(--text); }
.danger {
  margin-left: 6px;
  padding: 1px 7px;
  border-radius: 20px;
  font-size: 11px;
  border: 1px solid currentColor;
  opacity: 0.92;
}
.danger.muted { color: var(--text-faint); border-color: var(--line); }

.vitals {
  display: flex;
  gap: 16px;
  margin-left: auto;
}
.vital {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11.5px;
}
.vital-name { color: var(--text-faint); width: 26px; }
.vital .gauge-rail { width: 92px; }
.vital-text { color: var(--text-dim); min-width: 46px; text-align: right; font-variant-numeric: tabular-nums; }

.actions { display: flex; gap: 6px; }
.model-btn { color: var(--brass); border: 1px solid var(--line); border-radius: 8px; padding: 0 9px; max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: #171c24; cursor: pointer; font-size: 11px; }
.icon-btn {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: #171c24;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  transition: all 0.15s;
}
.icon-btn:hover { color: var(--brass); border-color: var(--brass-dim); background: #1d232c; }

@media (max-width: 1400px) {
  .vitals .vital .gauge-rail { width: 64px; }
  .subtitle { display: none; }
}
</style>
