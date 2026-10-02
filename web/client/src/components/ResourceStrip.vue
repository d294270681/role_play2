<script setup>
import { computed } from "vue";
import { game, navigate } from "../store.js";
import { resourceRows, resourceAlerts } from "../ui.js";
import GaugeMeter from "./GaugeMeter.vue";
const rows = computed(() =>
  resourceRows(game.state).filter((row) =>
    ["生命", "精力", "决心", "压力"].includes(row.name),
  ),
);
const alerts = computed(() => resourceAlerts(game.state));
</script>
<template>
  <div v-if="game.loaded" class="resource-area">
    <div class="resource-strip">
      <button
        v-for="row in rows"
        :key="row.name"
        class="resource-card"
        :title="'查看' + row.name + '及角色状态'"
        @click="navigate('character')"
      >
        <GaugeMeter :name="row.name" :gauge="row" />
      </button>
    </div>
    <div v-if="alerts.length" class="resource-alerts" role="status">
      <span v-for="alert in alerts" :key="alert">! {{ alert }}</span>
    </div>
  </div>
</template>
<style scoped>
.resource-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
.resource-card {
  display: block;
  text-align: left;
  border: 1px solid var(--line-soft);
  background: var(--ink-820);
  border-radius: 12px;
  padding: 15px 17px;
  color: var(--text);
}
.resource-card:hover {
  border-color: var(--line-bright);
  background: var(--ink-780);
}
.resource-alerts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  font-size: 12px;
  color: var(--ember);
  padding: 9px 3px 0;
}
@media (max-width: 700px) {
  .resource-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .resource-card {
    padding: 11px 13px;
  }
}
</style>
