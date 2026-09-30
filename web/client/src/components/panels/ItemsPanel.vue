<script setup>
import { computed, ref } from "vue";

import { applyEdit, game } from "../../store.js";

const inv = computed(() => game.state?.inventory || []);
const funds = computed(() => Number(game.state?.funds) || 0);
const capacity = computed(() => Number(game.state?.character?.capacity) || 0);
const usedSlots = computed(() => inv.value.reduce((sum, it) => sum + (Number(it.slots) || 0) * (Number(it.qty) || 1), 0));

const newItem = ref({ name: "", qty: 1, slots: 1, note: "" });
const showAdd = ref(false);

async function add() {
  const name = newItem.value.name.trim();
  if (!name) return;
  const ok = await applyEdit({
    op: "add_item",
    name,
    qty: Number(newItem.value.qty) || 1,
    slots: Number(newItem.value.slots) || 1,
    note: newItem.value.note.trim(),
  });
  if (ok) {
    newItem.value = { name: "", qty: 1, slots: 1, note: "" };
    showAdd.value = false;
  }
}

const setQty = (name, qty) => applyEdit({ op: "set_item_qty", name, qty: Number(qty) || 0 });
const remove = (name) => applyEdit({ op: "remove_item", name });
</script>

<template>
  <div v-if="!game.loaded" class="empty-hint">还没有载入存档。</div>

  <template v-else>
    <section class="card">
      <h4 class="section-label">资金</h4>
      <div class="funds-row">
        <span class="funds-n">{{ funds }}</span>
        <n-input-number
          :value="funds"
          size="small"
          :min="0"
          style="width: 110px"
          @change="(v) => applyEdit({ op: 'set_funds', value: Number(v) || 0 })"
        />
      </div>
      <div class="slots-row">
        <span>占用格数</span>
        <b :class="{ over: usedSlots > capacity }">{{ usedSlots }} / {{ capacity || "—" }}</b>
        <div class="gauge-rail" style="flex: 1">
          <div class="gauge-fill" :style="{ width: capacity ? Math.min(100, (usedSlots / capacity) * 100) + '%' : '0%' }" />
        </div>
      </div>
    </section>

    <section class="card">
      <div class="head-row">
        <h4 class="section-label" style="margin: 0; flex: 1">背包（{{ inv.length }}）</h4>
        <n-button size="tiny" type="primary" ghost @click="showAdd = !showAdd">
          {{ showAdd ? "取消" : "＋ 添加" }}
        </n-button>
      </div>

      <div v-if="showAdd" class="add-box">
        <n-input v-model:value="newItem.name" size="small" placeholder="道具名" />
        <div class="add-line">
          <n-input-number v-model:value="newItem.qty" size="small" :min="1" style="width: 74px" placeholder="数量" />
          <n-input-number v-model:value="newItem.slots" size="small" :min="1" style="width: 74px" placeholder="格" />
          <n-input v-model:value="newItem.note" size="small" placeholder="备注" style="flex: 1" />
        </div>
        <n-button size="small" type="primary" block :disabled="!newItem.name.trim()" @click="add">加入背包</n-button>
      </div>

      <ul class="item-list">
        <li v-for="it in inv" :key="it.name" class="item">
          <div class="item-head">
            <span class="i-name">{{ it.name }}</span>
            <n-input-number
              :value="Number(it.qty) || 0"
              size="tiny"
              :min="0"
              style="width: 66px"
              @change="(v) => setQty(it.name, v)"
            />
            <button class="mini" :title="`占用 ${it.slots} 格`">▦ {{ it.slots }}</button>
            <button class="mini danger" title="移除" @click="remove(it.name)">✕</button>
          </div>
          <div v-if="it.note" class="i-note">{{ it.note }}</div>
        </li>
        <li v-if="!inv.length" class="empty-hint">背包是空的。</li>
      </ul>
    </section>
  </template>
</template>

<style scoped>
.card { display: flex; flex-direction: column; gap: 9px; }
.head-row { display: flex; align-items: center; gap: 8px; }

.funds-row { display: flex; align-items: center; justify-content: space-between; }
.funds-n { font-family: var(--serif); font-size: 24px; color: var(--brass); font-variant-numeric: tabular-nums; }
.slots-row { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--text-faint); }
.slots-row b { color: var(--text-dim); font-variant-numeric: tabular-nums; }
.slots-row b.over { color: var(--blood); }

.add-box { display: flex; flex-direction: column; gap: 6px; padding: 9px; border: 1px dashed var(--line); border-radius: 9px; }
.add-line { display: flex; gap: 6px; }

.item-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.item { padding: 6px 8px; border-radius: 8px; background: #161c24; border: 1px solid var(--line-soft); }
.item-head { display: flex; align-items: center; gap: 6px; }
.i-name { flex: 1; font-size: 12.5px; color: var(--text); }
.i-note { font-size: 10.5px; color: var(--text-faint); margin-top: 3px; }

.mini {
  height: 20px;
  padding: 0 6px;
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
