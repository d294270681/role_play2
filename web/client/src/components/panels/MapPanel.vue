<script setup>
import { computed, ref } from "vue";

import { currentLocation, game, generateImage, locationDanger, moveTo, notify } from "../../store.js";
import { dangerClass, dangerColor, dangerWord, isNight, currentPeriod } from "../../util.js";

const loc = computed(() => currentLocation());
const period = computed(() => currentPeriod(game.state));
const night = computed(() => isNight(period.value));
const danger = computed(() => locationDanger(loc.value));

const locations = computed(() => game.map.locations || []);
const routes = computed(() => game.map.routes || []);

const imgBusy = ref("");

function isCurrent(name) {
  return String(game.state?.location ?? "").trim() === String(name ?? "").trim();
}

/** 当前地点与哪些地点直接相连（后端 routes + 地点 connections）。 */
function reachable(name) {
  const here = loc.value;
  if (!here) return true;
  const from = String(here.name);
  const to = String(name);
  if (from === to) return false;
  const byRoute = routes.value.some(
    (r) => (r.from === from && r.to === to) || (r.to === from && r.from === to),
  );
  const byConn = (here.connections || []).some((c) => String(c).includes(to) || to.includes(String(c)));
  return byRoute || byConn;
}

async function go(name) {
  if (isCurrent(name)) return;
  if (game.busy) {
    notify("回合进行中，稍后再移动", "warn");
    return;
  }
  if (!reachable(name)) {
    notify(`「${loc.value?.name || "这里"}」到「${name}」没有相邻路线`, "warn");
    return;
  }
  await moveTo(name);
}

function useAction(text) {
  const here = loc.value?.name || "这里";
  game.pendingAction = `在${here}：${text}`;
}

async function drawLocation(name) {
  imgBusy.value = name;
  const data = await generateImage({ kind: "location", name });
  imgBusy.value = "";
  if (data) notify(`「${name}」的地点图已生成`, "success");
}

const locImage = computed(() => (loc.value ? game.locationImage?.[loc.value.name] || "" : ""));
</script>

<template>
  <div v-if="!game.loaded" class="empty-hint">还没有载入存档。</div>

  <template v-else>
    <!-- 当前地点 -->
    <section class="card cur">
      <div class="cur-head">
        <div class="cur-name">{{ loc?.name || game.state?.location || "未知地点" }}</div>
        <span v-if="loc" class="danger-badge" :class="dangerClass(danger)">
          危险度 {{ danger }} · {{ dangerWord(danger) }}
        </span>
      </div>

      <div class="cur-img">
        <img v-if="locImage" :src="locImage" :alt="loc?.name" @click="game.lightbox = { url: locImage, prompt: loc?.name }" />
        <div v-else class="img-empty">
          <span>{{ loc?.name || "当前地点" }} 尚无立绘</span>
          <button
            class="img-btn"
            :disabled="imgBusy === (loc?.name || '') || !game.comfy?.available"
            @click="drawLocation(loc?.name || '')"
          >
            {{ imgBusy === (loc?.name || '') ? "生成中…" : "生成地点图" }}
          </button>
        </div>
      </div>

      <div class="cur-meta">
        <span v-if="loc?.faction">势力：{{ loc.faction }}</span>
        <span v-if="loc && loc.night_danger !== null && loc.night_danger !== undefined">
          夜间 {{ loc.night_danger }}
        </span>
        <span class="dim">当前时段 {{ period }}{{ night ? "（夜间）" : "" }}</span>
      </div>
      <p v-if="loc?.desc" class="cur-desc">{{ loc.desc }}</p>

      <template v-if="loc?.npcs?.length">
        <div class="chip-label">常驻 NPC</div>
        <div class="chips">
          <span v-for="n in loc.npcs" :key="n" class="chip npc">{{ n }}</span>
        </div>
      </template>

      <template v-if="loc?.actions?.length">
        <div class="chip-label">可用行动</div>
        <div class="actions">
          <button
            v-for="(a, i) in loc.actions"
            :key="i"
            class="act"
            :disabled="game.busy"
            :title="a"
            @click="useAction(a.split('→')[0].trim() || a)"
          >
            {{ a }}
          </button>
        </div>
      </template>
    </section>

    <!-- 地点列表 -->
    <section class="card">
      <h4 class="section-label">地点（{{ locations.length }}）</h4>
      <ul class="loc-list">
        <li
          v-for="l in locations"
          :key="l.name"
          class="loc-item"
          :class="{ here: isCurrent(l.name), far: !reachable(l.name) }"
        >
          <div class="loc-row" @click="go(l.name)">
            <span class="pin" :style="{ background: dangerColor(l.danger) }" />
            <span class="loc-n">{{ l.name }}</span>
            <span class="loc-d" :class="dangerClass(l.danger)">{{ l.danger ?? "—" }}</span>
            <span v-if="isCurrent(l.name)" class="here-tag">当前</span>
          </div>
          <div v-if="l.desc" class="loc-desc">{{ l.desc }}</div>
        </li>
        <li v-if="!locations.length" class="empty-hint">本册没有解析出地点。</li>
      </ul>
      <p class="hint">点击地点移动（自动按时段推进并做途中事件判定）。</p>
    </section>

    <!-- 路线表 -->
    <section v-if="routes.length" class="card">
      <h4 class="section-label">路线表</h4>
      <div class="routes">
        <div v-for="(r, i) in routes" :key="i" class="route">
          <span class="r-code">{{ r.code || `R${i + 1}` }}</span>
          <span class="r-path">{{ r.from }} <i>→</i> {{ r.to }}</span>
          <span class="r-meta">
            {{ r.time_slots ?? 1 }} 时段
            <em class="danger" :class="dangerClass(r.danger)">危 {{ r.danger ?? "—" }}</em>
          </span>
          <div v-if="r.note" class="r-note">{{ r.note }}</div>
        </div>
      </div>
    </section>
  </template>
</template>

<style scoped>
.card { display: flex; flex-direction: column; gap: 9px; }

.cur-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.cur-name { font-family: var(--serif); font-size: 17px; letter-spacing: 0.05em; }
.danger-badge {
  font-size: 10.5px;
  padding: 2px 8px;
  border-radius: 11px;
  border: 1px solid currentColor;
  white-space: nowrap;
}

.cur-img {
  border-radius: 9px;
  overflow: hidden;
  border: 1px solid var(--line);
  background: #0b0e12;
  min-height: 92px;
  display: grid;
  place-items: center;
}
.cur-img img { width: 100%; max-height: 190px; object-fit: cover; display: block; cursor: zoom-in; }
.img-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  padding: 14px;
  color: var(--text-faint);
  font-size: 11.5px;
  width: 100%;
}
.img-btn {
  padding: 4px 12px;
  border-radius: 7px;
  border: 1px solid var(--brass-dim);
  background: rgba(212, 169, 74, 0.1);
  color: var(--brass);
  font-size: 11.5px;
  cursor: pointer;
}
.img-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.cur-meta { display: flex; flex-wrap: wrap; gap: 10px; font-size: 11px; color: var(--text-dim); }
.cur-meta .dim { color: var(--text-faint); }
.cur-desc { margin: 0; font-size: 12.5px; line-height: 1.85; color: var(--text-dim); font-family: var(--serif); }

.chip-label { font-size: 10.5px; letter-spacing: 0.1em; color: var(--text-faint); margin-top: 2px; }
.chips { display: flex; flex-wrap: wrap; gap: 5px; }
.chip.npc {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 11px;
  color: var(--violet);
  border: 1px solid rgba(155, 127, 212, 0.35);
  background: rgba(155, 127, 212, 0.08);
}

.actions { display: flex; flex-direction: column; gap: 5px; }
.act {
  text-align: left;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--line-soft);
  background: #161c24;
  color: var(--text-dim);
  font-size: 11.5px;
  line-height: 1.6;
  cursor: pointer;
  transition: all 0.15s;
}
.act:hover:not(:disabled) { color: var(--brass); border-color: var(--brass-dim); background: #1c232d; }
.act:disabled { opacity: 0.45; cursor: not-allowed; }

.loc-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.loc-item {
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.14s;
}
.loc-item:hover { background: #161c24; border-color: var(--line-soft); }
.loc-item.here { background: rgba(212, 169, 74, 0.08); border-color: rgba(212, 169, 74, 0.28); }
.loc-item.far { opacity: 0.5; }
.loc-row { display: flex; align-items: center; gap: 7px; }
.pin { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.loc-n { font-size: 12.5px; color: var(--text); flex: 1; }
.loc-d { font-size: 11.5px; font-variant-numeric: tabular-nums; }
.here-tag { font-size: 9.5px; color: var(--brass); border: 1px solid var(--brass-dim); padding: 0 5px; border-radius: 8px; }
.loc-desc { font-size: 10.5px; color: var(--text-faint); line-height: 1.6; margin-top: 3px; padding-left: 14px; }

.routes { display: flex; flex-direction: column; gap: 6px; }
.route {
  display: grid;
  grid-template-columns: 34px 1fr auto;
  gap: 4px 8px;
  align-items: center;
  padding: 6px 8px;
  border-radius: 8px;
  background: #161c24;
  border: 1px solid var(--line-soft);
  font-size: 11.5px;
}
.r-code { color: var(--text-faint); font-size: 10.5px; }
.r-path { color: var(--text); }
.r-path i { color: var(--text-faint); font-style: normal; }
.r-meta { color: var(--text-dim); display: flex; gap: 6px; align-items: center; }
.r-meta em { font-style: normal; }
.r-note { grid-column: 2 / -1; font-size: 10.5px; color: var(--text-faint); }

.hint { font-size: 10.5px; color: var(--text-faint); margin: 0; }
</style>
