<script setup>
import { computed, ref } from "vue";
import Icon from "../Icon.vue";
import { applyEdit, game } from "../../store.js";
import { inventoryLoad } from "../../ui.js";
const inventory = computed(() => game.state?.inventory || []),
  funds = computed(() => Number(game.state?.funds) || 0);
const capacity = computed(() => Number(game.state?.character?.capacity) || 0),
  used = computed(() => inventoryLoad(inventory.value));
const query = ref(""),
  editing = ref(false),
  showAdd = ref(false);
const filtered = computed(() =>
  inventory.value.filter((item) =>
    (item.name + " " + (item.note || ""))
      .toLowerCase()
      .includes(query.value.trim().toLowerCase()),
  ),
);
const draft = ref({ name: "", qty: 1, slots: 1, note: "" });
async function add() {
  if (!draft.value.name.trim()) return;
  if (
    await applyEdit({
      op: "add_item",
      name: draft.value.name.trim(),
      qty: Number(draft.value.qty) || 1,
      slots: Number(draft.value.slots) || 1,
      note: draft.value.note.trim(),
    })
  ) {
    draft.value = { name: "", qty: 1, slots: 1, note: "" };
    showAdd.value = false;
  }
}
const iconFor = (name) =>
  /棍|剑|刀|枪|弓/.test(name)
    ? "swords"
    : /本|信|证|图/.test(name)
      ? "book"
      : "backpack";
</script>
<template>
  <div v-if="!game.loaded" class="empty-hint">
    载入角色后，随身物品与资金会显示在这里。
  </div>
  <template v-else>
    <div class="inventory-stats">
      <section class="card funds-card">
        <Icon name="coin" :size="28" />
        <div>
          <span>可用资金</span><b>{{ funds }}</b>
        </div>
        <n-input-number
          v-if="editing"
          :value="funds"
          :disabled="game.busy"
          :min="0"
          size="small"
          style="width: 130px"
          @change="
            (value) => applyEdit({ op: 'set_funds', value: Number(value) || 0 })
          "
        />
      </section>
      <section class="card load-card">
        <div>
          <span>背包负重</span
          ><b :class="{ over: used > capacity }"
            >{{ used }}<small> / {{ capacity }} 格</small></b
          >
        </div>
        <div class="load-track">
          <i
            :style="{
              width: capacity
                ? Math.min(100, (used / capacity) * 100) + '%'
                : '0%',
            }"
            :class="{ over: used > capacity }"
          ></i>
        </div>
        <span class="hint">{{
          used > capacity
            ? "已超出负重，请整理物品"
            : "还有 " + Math.max(0, capacity - used) + " 格空间"
        }}</span>
      </section>
    </div>
    <div class="panel-toolbar inventory-toolbar">
      <div class="search-field">
        <Icon name="search" :size="15" /><input
          v-model="query"
          aria-label="搜索背包"
          placeholder="搜索名称或备注…"
        />
      </div>
      <div class="toolbar-buttons">
        <button
          class="secondary-button"
          :aria-pressed="editing"
          @click="editing = !editing"
        >
          {{ editing ? "完成管理" : "管理背包" }}</button
        ><button
          class="primary-button"
          :disabled="game.busy"
          @click="showAdd = true"
        >
          <Icon name="plus" :size="15" />添加物品
        </button>
      </div>
    </div>
    <div class="inventory-grid">
      <article v-for="item in filtered" :key="item.name" class="item-card">
        <div class="item-art">
          <Icon :name="iconFor(item.name)" :size="32" /><span
            class="item-quantity"
            >×{{ item.qty ?? 1 }}</span
          >
        </div>
        <div class="item-info">
          <h3>{{ item.name }}</h3>
          <p>{{ item.note || "暂无物品备注" }}</p>
          <span class="tag subtle">每件 {{ item.slots || 0 }} 格</span>
        </div>
        <div v-if="editing" class="item-controls">
          <n-input-number
            :value="Number(item.qty) || 0"
            :min="0"
            :disabled="game.busy"
            size="small"
            @change="
              (value) =>
                applyEdit({
                  op: 'set_item_qty',
                  name: item.name,
                  qty: Number(value) || 0,
                })
            "
          /><button
            class="icon-button remove-item"
            :aria-label="'移除' + item.name"
            :disabled="game.busy"
            @click="applyEdit({ op: 'remove_item', name: item.name })"
          >
            <Icon name="close" :size="16" />
          </button>
        </div>
      </article>
      <div v-if="!filtered.length" class="empty-hint">
        {{
          query
            ? "没有找到匹配的物品。"
            : "背包还是空的。将获得的装备或道具添加到这里。"
        }}
      </div>
    </div>
    <n-modal
      v-model:show="showAdd"
      preset="card"
      title="添加物品"
      style="max-width: 440px"
      :bordered="false"
      ><div class="item-form">
        <label>物品名称</label
        ><n-input v-model:value="draft.name" placeholder="例如：绳子" />
        <div class="item-form-grid">
          <div>
            <label>数量</label
            ><n-input-number v-model:value="draft.qty" :min="1" />
          </div>
          <div>
            <label>每件占用格数</label
            ><n-input-number v-model:value="draft.slots" :min="1" />
          </div>
        </div>
        <label>备注</label
        ><n-input
          v-model:value="draft.note"
          placeholder="携带位置、用途或其他备注"
        />
      </div>
      <template #footer
        ><div class="modal-actions">
          <n-button @click="showAdd = false">取消</n-button
          ><n-button
            type="primary"
            :disabled="!draft.name.trim() || game.busy"
            @click="add"
            >加入背包</n-button
          >
        </div></template
      ></n-modal
    >
  </template>
</template>
<style scoped>
.inventory-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
  margin-bottom: 22px;
}
.funds-card {
  display: flex;
  gap: 19px;
  align-items: center;
}
.funds-card > svg {
  color: var(--brass);
}
.funds-card > div {
  flex: 1;
}
.funds-card span,
.load-card > div > span {
  display: block;
  font-size: 11px;
  color: var(--text-faint);
}
.funds-card b,
.load-card b {
  font-size: 29px;
  font-weight: 600;
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
}
.funds-card b {
  color: var(--brass);
}
.load-card b small {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-faint);
}
.load-card > div:first-child {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.load-track {
  height: 6px;
  border-radius: 4px;
  background: var(--ink-950);
  overflow: hidden;
  margin: 8px 0 7px;
}
.load-track i {
  height: 100%;
  background: var(--moss);
  display: block;
}
.load-track i.over {
  background: var(--blood);
}
.over {
  color: var(--blood);
}
.search-field {
  display: flex;
  align-items: center;
  gap: 9px;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 9px 12px;
  min-width: 0;
  width: 310px;
  background: var(--ink-860);
  color: var(--text-faint);
}
.search-field input {
  background: none;
  border: 0;
  outline: none;
  width: 100%;
  min-width: 0;
  color: var(--text);
  font-size: 12px;
}
.search-field input::placeholder {
  color: var(--text-faint);
}
.search-field:focus-within {
  border-color: var(--brass-dim);
}
.toolbar-buttons {
  display: flex;
  gap: 9px;
}
.inventory-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 15px;
}
.item-card {
  border: 1px solid var(--line-soft);
  border-radius: 12px;
  overflow: hidden;
  background: var(--ink-820);
}
.item-art {
  height: 107px;
  background: radial-gradient(ellipse at 50% 0, #2c3b37, var(--ink-820) 80%);
  display: grid;
  place-items: center;
  color: #93ab9d;
  position: relative;
}
.item-quantity {
  position: absolute;
  top: 12px;
  right: 12px;
  color: var(--text-dim);
  font-size: 11px;
  background: var(--ink-860);
  padding: 2px 6px;
  border-radius: 4px;
}
.item-info {
  padding: 15px 17px 18px;
}
.item-info h3 {
  font-size: 14px;
  font-weight: 500;
  margin: 0 0 7px;
}
.item-info p {
  font-size: 11px;
  color: var(--text-faint);
  margin: 0 0 12px;
  line-height: 1.8;
}
.item-controls {
  display: flex;
  gap: 8px;
  border-top: 1px solid var(--line);
  padding: 10px;
}
.item-controls > .n-input-number {
  flex: 1;
  min-width: 0;
}
.remove-item {
  color: var(--blood);
}
.inventory-grid > .empty-hint {
  grid-column: 1/-1;
}
.item-form {
  display: grid;
  gap: 9px;
}
.item-form label {
  display: block;
  font-size: 12px;
  color: var(--text-dim);
}
.item-form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin: 7px 0;
}
.item-form-grid label {
  margin-bottom: 7px;
}
.modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
@media (max-width: 1400px) {
  .inventory-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (max-width: 900px) {
  .inventory-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .inventory-stats {
    gap: 12px;
  }
}
@media (max-width: 650px) {
  .inventory-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  .inventory-stats {
    grid-template-columns: 1fr;
    gap: 10px;
  }
  .inventory-toolbar {
    gap: 10px;
  }
  .search-field {
    width: 100%;
  }
  .toolbar-buttons {
    margin-left: auto;
  }
  .item-art {
    height: 85px;
  }
  .item-info {
    padding: 12px;
  }
}
</style>
