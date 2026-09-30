<script setup>
import { computed, ref } from "vue";

import { game } from "../../store.js";

const fired = computed(() => game.state?.events_fired || []);
const pending = computed(() => game.state?.pending_event || null);
const deck = computed(() => game.events || []);
const log = computed(() => (game.state?.log || []).slice(-40).reverse());

const showDeck = ref(false);
const showLog = ref(false);
const firedCodes = computed(() => new Set(fired.value.map((e) => String(e.code))));

function typeClass(t) {
  if (t === "事件") return "ev";
  if (t === "移动") return "mv";
  if (t === "行动") return "ac";
  if (t === "叙事") return "nr";
  return "ot";
}
</script>

<template>
  <div v-if="!game.loaded" class="empty-hint">还没有载入存档。</div>

  <template v-else>
    <section v-if="pending && (pending.code || pending.name)" class="card pending">
      <h4 class="section-label">待处理事件</h4>
      <div class="p-line">
        <span class="p-code">{{ pending.code }}</span>
        <span class="p-name">{{ pending.name }}</span>
      </div>
      <p class="hint">GM 会在下一回合把这条事件演进叙事，处理完自动清除。</p>
    </section>

    <section class="card">
      <h4 class="section-label">已触发事件（{{ fired.length }}）</h4>
      <ul class="ev-list">
        <li v-for="(e, i) in fired" :key="`${e.code}-${i}`" class="ev">
          <span class="e-code">{{ e.code }}</span>
          <span class="e-name">{{ e.name }}</span>
          <span class="e-day">第 {{ e.day }} 天</span>
        </li>
        <li v-if="!fired.length" class="empty-hint">还没有触发过事件牌。</li>
      </ul>
    </section>

    <section class="card">
      <div class="head-row">
        <h4 class="section-label" style="margin: 0; flex: 1">本册事件牌（{{ deck.length }}）</h4>
        <n-button size="tiny" quaternary @click="showDeck = !showDeck">
          {{ showDeck ? "收起" : "展开" }}
        </n-button>
      </div>
      <ul v-if="showDeck" class="deck">
        <li v-for="e in deck" :key="`${e.code}-${e.name}`" :class="{ used: firedCodes.has(String(e.code)) }">
          <span class="d-code">{{ e.code }}</span>
          <span class="d-name">{{ e.name }}</span>
          <span v-if="firedCodes.has(String(e.code))" class="d-used">已用</span>
          <span v-else-if="e.special" class="d-spec">特殊</span>
        </li>
      </ul>
    </section>

    <section class="card">
      <div class="head-row">
        <h4 class="section-label" style="margin: 0; flex: 1">冒险日志（{{ game.state?.log?.length || 0 }}）</h4>
        <n-button size="tiny" quaternary @click="showLog = !showLog">
          {{ showLog ? "收起" : "展开" }}
        </n-button>
      </div>
      <ul v-if="showLog" class="log">
        <li v-for="(l, i) in log" :key="i">
          <span class="l-stamp">第{{ l.day }}天·{{ l.period }}</span>
          <span class="l-type" :class="typeClass(l.type)">{{ l.type }}</span>
          <span class="l-text">{{ l.text }}</span>
        </li>
        <li v-if="!log.length" class="empty-hint">日志是空的。</li>
      </ul>
    </section>
  </template>
</template>

<style scoped>
.card { display: flex; flex-direction: column; gap: 9px; }
.head-row { display: flex; align-items: center; gap: 8px; }

.pending { padding: 10px; border-radius: 10px; border: 1px solid rgba(217, 139, 58, 0.35); background: rgba(217, 139, 58, 0.07); }
.p-line { display: flex; align-items: baseline; gap: 9px; }
.p-code { font-family: var(--serif); font-size: 17px; color: var(--ember); }
.p-name { font-size: 13px; color: var(--text); }
.hint { font-size: 10.5px; color: var(--text-faint); margin: 0; line-height: 1.7; }

.ev-list, .deck, .log { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.ev {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 7px;
  background: #161c24;
  border: 1px solid var(--line-soft);
}
.e-code { font-size: 11px; color: var(--ember); font-variant-numeric: tabular-nums; min-width: 30px; }
.e-name { flex: 1; font-size: 12px; color: var(--text-dim); }
.e-day { font-size: 10px; color: var(--text-faint); }

.deck li { display: flex; align-items: baseline; gap: 8px; padding: 3px 6px; font-size: 11.5px; border-radius: 6px; }
.deck li:nth-child(odd) { background: rgba(255, 255, 255, 0.015); }
.deck li.used { opacity: 0.4; text-decoration: line-through; }
.d-code { color: var(--text-faint); min-width: 30px; font-variant-numeric: tabular-nums; }
.d-name { flex: 1; color: var(--text-dim); }
.d-used { font-size: 9.5px; color: var(--text-faint); }
.d-spec { font-size: 9.5px; color: var(--violet); }

.log li { display: flex; gap: 7px; align-items: baseline; padding: 3px 0; border-bottom: 1px dashed var(--line-soft); font-size: 11px; }
.l-stamp { color: var(--text-faint); flex-shrink: 0; font-size: 10px; }
.l-type {
  flex-shrink: 0;
  font-size: 9.5px;
  padding: 0 5px;
  border-radius: 8px;
  border: 1px solid var(--line);
  color: var(--text-faint);
}
.l-type.ev { color: var(--ember); border-color: rgba(217, 139, 58, 0.4); }
.l-type.mv { color: var(--azure); border-color: rgba(95, 149, 216, 0.4); }
.l-type.ac { color: var(--brass); border-color: var(--brass-dim); }
.l-type.nr { color: var(--text-dim); }
.l-text { flex: 1; color: var(--text-dim); line-height: 1.7; }
</style>
