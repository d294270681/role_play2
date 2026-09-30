<script setup>
import { game } from "../store.js";

import CharacterPanel from "./panels/CharacterPanel.vue";
import MapPanel from "./panels/MapPanel.vue";
import ItemsPanel from "./panels/ItemsPanel.vue";
import ClocksPanel from "./panels/ClocksPanel.vue";
import RelationsPanel from "./panels/RelationsPanel.vue";
import CluesPanel from "./panels/CluesPanel.vue";
import EventsPanel from "./panels/EventsPanel.vue";

const TABS = [
  { key: "character", label: "角色" },
  { key: "map", label: "地图" },
  { key: "items", label: "物品" },
  { key: "clocks", label: "进度钟" },
  { key: "relations", label: "关系" },
  { key: "clues", label: "线索" },
  { key: "events", label: "事件" },
];
</script>

<template>
  <aside class="right" :class="{ collapsed: game.rightCollapsed }">
    <template v-if="game.rightCollapsed">
      <button class="rail-btn" title="展开右栏" @click="game.rightCollapsed = false">‹</button>
    </template>

    <template v-else>
      <n-tabs
        v-model:value="game.rightTab"
        type="line"
        animated
        class="tabs"
        pane-style="height: 100%; padding: 0;"
        pane-wrapper-style="height: 100%;"
      >
        <n-tab-pane v-for="t in TABS" :key="t.key" :name="t.key" :tab="t.label">
          <div class="pane-body">
            <template v-if="t.key === 'character'"><CharacterPanel /></template>
            <template v-else-if="t.key === 'map'"><MapPanel /></template>
            <template v-else-if="t.key === 'items'"><ItemsPanel /></template>
            <template v-else-if="t.key === 'clocks'"><ClocksPanel /></template>
            <template v-else-if="t.key === 'relations'"><RelationsPanel /></template>
            <template v-else-if="t.key === 'clues'"><CluesPanel /></template>
            <template v-else-if="t.key === 'events'"><EventsPanel /></template>
          </div>
        </n-tab-pane>
      </n-tabs>
    </template>
  </aside>
</template>

<style scoped>
.right {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.right.collapsed { padding: 10px 6px; align-items: center; }

.rail-btn {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: #171c24;
  color: var(--text-dim);
  cursor: pointer;
}

.tabs {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.tabs :deep(.n-tabs-nav) { padding: 8px 10px 0; margin-bottom: 0; }
.tabs :deep(.n-tabs-pane-wrapper) { flex: 1; min-height: 0; overflow: hidden; }

.pane-body {
  height: 100%;
  overflow-y: auto;
  padding: 12px 12px 26px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
</style>
