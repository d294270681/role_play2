<script setup>
import { computed, ref } from "vue";
import Icon from "../Icon.vue";
import { game, stageAction } from "../../store.js";
import { inventoryLoad } from "../../ui.js";
const inventory = computed(() => game.state?.inventory || []);
const funds = computed(() => Number(game.state?.funds) || 0);
const capacity = computed(() => Number(game.state?.character?.capacity) || 0);
const used = computed(() => inventoryLoad(inventory.value));
const query = ref("");
const filtered = computed(() =>
  inventory.value.filter((item) =>
    (item.name + " " + (item.note || ""))
      .toLowerCase()
      .includes(query.value.trim().toLowerCase()),
  ),
);
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
            ? "已超出负重，可以通过行动整理物品"
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
      <p class="hint">获得、购买和消耗物品后，背包会随行动结算更新。</p>
    </div>
    <div class="inventory-grid">
      <article
        v-for="(item, index) in filtered"
        :key="index + ':' + item.name"
        class="item-card"
      >
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
        <div class="item-actions">
          <button
            class="text-button"
            :disabled="game.busy || (item.qty ?? 1) <= 0"
            :aria-label="'写下使用' + item.name + '的行动'"
            @click="stageAction('尝试使用背包中的' + item.name)"
          >
            写下使用行动<Icon name="arrow" :size="14" />
          </button>
        </div>
      </article>
      <div v-if="!filtered.length" class="empty-hint">
        {{
          query
            ? "没有找到匹配的物品。"
            : "背包为空。旅途中实际获得的物品会自动记录在这里。"
        }}
      </div>
    </div>
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
.item-actions {
  padding: 0 17px 16px;
}
.item-actions button {
  width: 100%;
  justify-content: space-between;
}
.inventory-grid > .empty-hint {
  grid-column: 1/-1;
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
