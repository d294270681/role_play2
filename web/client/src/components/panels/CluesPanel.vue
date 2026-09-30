<script setup>
import { computed, ref } from "vue";

import { applyEdit, game } from "../../store.js";

const clues = computed(() => game.state?.clues || []);
const open = computed(() => clues.value.filter((c) => !c.done));
const done = computed(() => clues.value.filter((c) => c.done));

const draft = ref("");
const showAdd = ref(false);

async function add() {
  const text = draft.value.trim();
  if (!text) return;
  const ok = await applyEdit({ op: "add_clue", text });
  if (ok) {
    draft.value = "";
    showAdd.value = false;
  }
}

const toggle = (c) => applyEdit({ op: "toggle_clue", text: c.text });
const remove = (c) => applyEdit({ op: "remove_clue", text: c.text });
</script>

<template>
  <div v-if="!game.loaded" class="empty-hint">还没有载入存档。</div>

  <template v-else>
    <section class="card">
      <div class="head-row">
        <h4 class="section-label" style="margin: 0; flex: 1">线索 · 未完成（{{ open.length }}）</h4>
        <n-button size="tiny" type="primary" ghost @click="showAdd = !showAdd">
          {{ showAdd ? "取消" : "＋ 记一笔" }}
        </n-button>
      </div>

      <div v-if="showAdd" class="add-box">
        <n-input
          v-model:value="draft"
          type="textarea"
          size="small"
          :autosize="{ minRows: 2, maxRows: 4 }"
          placeholder="记下一条线索……"
          @keyup.ctrl.enter="add"
        />
        <n-button size="small" type="primary" block :disabled="!draft.trim()" @click="add">加入线索板</n-button>
      </div>

      <ul class="clue-list">
        <li v-for="c in open" :key="c.text" class="clue">
          <button class="box" title="标记完成" @click="toggle(c)" />
          <span class="c-text">{{ c.text }}</span>
          <button class="mini danger" title="删除" @click="remove(c)">✕</button>
        </li>
        <li v-if="!open.length" class="empty-hint">还没有未完成的线索。</li>
      </ul>
    </section>

    <section v-if="done.length" class="card">
      <h4 class="section-label">已完成（{{ done.length }}）</h4>
      <ul class="clue-list">
        <li v-for="c in done" :key="c.text" class="clue is-done">
          <button class="box checked" title="重新打开" @click="toggle(c)" />
          <span class="c-text">{{ c.text }}</span>
          <button class="mini danger" title="删除" @click="remove(c)">✕</button>
        </li>
      </ul>
    </section>
  </template>
</template>

<style scoped>
.card { display: flex; flex-direction: column; gap: 9px; }
.head-row { display: flex; align-items: center; gap: 8px; }
.add-box { display: flex; flex-direction: column; gap: 6px; padding: 9px; border: 1px dashed var(--line); border-radius: 9px; }

.clue-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.clue {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 8px;
  background: #161c24;
  border: 1px solid var(--line-soft);
}
.box {
  width: 14px;
  height: 14px;
  margin-top: 3px;
  flex-shrink: 0;
  border-radius: 4px;
  border: 1px solid var(--line);
  background: #0e1218;
  cursor: pointer;
  transition: all 0.15s;
}
.box:hover { border-color: var(--brass-dim); }
.box.checked { background: var(--moss); border-color: var(--moss); }
.c-text { flex: 1; font-size: 12px; line-height: 1.7; color: var(--text-dim); }
.clue.is-done .c-text { color: var(--text-faint); text-decoration: line-through; }

.mini {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  border-radius: 5px;
  border: 1px solid var(--line);
  background: #171c24;
  color: var(--text-faint);
  font-size: 10px;
  cursor: pointer;
  line-height: 1;
}
.mini.danger:hover { color: var(--blood); border-color: rgba(194, 80, 76, 0.5); }
</style>
