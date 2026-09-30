<script setup>
import { computed, ref } from "vue";

import { applyEdit, game } from "../../store.js";

const clocks = computed(() => game.state?.clocks || []);

const draft = ref({ name: "", max: 6, consequence: "" });
const showAdd = ref(false);

async function add() {
  const name = draft.value.name.trim();
  if (!name) return;
  const ok = await applyEdit({
    op: "add_clock",
    name,
    max: Number(draft.value.max) || 6,
    consequence: draft.value.consequence.trim(),
  });
  if (ok) {
    draft.value = { name: "", max: 6, consequence: "" };
    showAdd.value = false;
  }
}

async function advance(c, delta) {
  await applyEdit({ op: "set_clock", name: c.name, value: (Number(c.value) || 0) + delta });
}

async function setValue(c, v) {
  await applyEdit({ op: "set_clock", name: c.name, value: Number(v) || 0 });
}

const remove = (name) => applyEdit({ op: "remove_clock", name });

/** ■□ 图形：填满的格子点亮，满格时闪烁提示后果。 */
function cells(c) {
  const max = Math.max(1, Math.min(12, Number(c.max) || 6));
  const value = Math.max(0, Math.min(max, Number(c.value) || 0));
  return Array.from({ length: max }, (_, i) => i < value);
}
</script>

<template>
  <div v-if="!game.loaded" class="empty-hint">还没有载入存档。</div>

  <template v-else>
    <section class="card">
      <div class="head-row">
        <h4 class="section-label" style="margin: 0; flex: 1">进度钟（{{ clocks.length }}）</h4>
        <n-button size="tiny" type="primary" ghost @click="showAdd = !showAdd">
          {{ showAdd ? "取消" : "＋ 新建" }}
        </n-button>
      </div>

      <div v-if="showAdd" class="add-box">
        <n-input v-model:value="draft.name" size="small" placeholder="钟名，如 码头戒严" />
        <div class="add-line">
          <n-input-number v-model:value="draft.max" size="small" :min="1" :max="12" style="width: 90px" />
          <n-input v-model:value="draft.consequence" size="small" placeholder="满格后果" style="flex: 1" />
        </div>
        <n-button size="small" type="primary" block :disabled="!draft.name.trim()" @click="add">建立</n-button>
      </div>

      <ul class="clock-list">
        <li v-for="c in clocks" :key="c.name" class="clock" :class="{ full: c.value >= c.max }">
          <div class="clock-head">
            <span class="c-name">{{ c.name }}</span>
            <span class="c-count">{{ c.value }} / {{ c.max }}</span>
            <button class="mini" @click="advance(c, 1)">+1</button>
            <button class="mini" @click="advance(c, -1)">−1</button>
            <button class="mini danger" title="移除" @click="remove(c.name)">✕</button>
          </div>
          <div class="clock-cells">
            <button
              v-for="(on, i) in cells(c)"
              :key="i"
              class="clock-cell"
              :class="{ on }"
              :title="on ? '点击减 1' : '点击加 1'"
              @click="setValue(c, on ? i : i + 1)"
            />
          </div>
          <div v-if="c.consequence" class="c-note">满格：{{ c.consequence }}</div>
        </li>
        <li v-if="!clocks.length" class="empty-hint">还没有进度钟。</li>
      </ul>
    </section>
  </template>
</template>

<style scoped>
.card { display: flex; flex-direction: column; gap: 9px; }
.head-row { display: flex; align-items: center; gap: 8px; }
.add-box { display: flex; flex-direction: column; gap: 6px; padding: 9px; border: 1px dashed var(--line); border-radius: 9px; }
.add-line { display: flex; gap: 6px; }

.clock-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.clock { padding: 8px; border-radius: 9px; background: #161c24; border: 1px solid var(--line-soft); }
.clock.full { border-color: rgba(194, 80, 76, 0.5); background: rgba(194, 80, 76, 0.06); }
.clock-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.c-name { flex: 1; font-size: 12.5px; color: var(--text); }
.c-count { font-size: 11px; color: var(--text-faint); font-variant-numeric: tabular-nums; }
.c-note { font-size: 10.5px; color: var(--text-faint); margin-top: 6px; }

.mini {
  height: 19px;
  min-width: 22px;
  padding: 0 5px;
  border-radius: 5px;
  border: 1px solid var(--line);
  background: #171c24;
  color: var(--text-faint);
  font-size: 10.5px;
  cursor: pointer;
  line-height: 1;
}
.mini:hover { color: var(--brass); border-color: var(--brass-dim); }
.mini.danger:hover { color: var(--blood); border-color: rgba(194, 80, 76, 0.5); }
</style>
