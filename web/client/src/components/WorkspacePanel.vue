<script setup>
import { game } from "../store.js";
import CharacterPanel from "./panels/CharacterPanel.vue";
import MapPanel from "./panels/MapPanel.vue";
import ItemsPanel from "./panels/ItemsPanel.vue";
import ClocksPanel from "./panels/ClocksPanel.vue";
import RelationsPanel from "./panels/RelationsPanel.vue";
import CluesPanel from "./panels/CluesPanel.vue";
import EventsPanel from "./panels/EventsPanel.vue";
import CombatPanel from "./panels/CombatPanel.vue";
const components = {
  character: CharacterPanel,
  map: MapPanel,
  items: ItemsPanel,
  clocks: ClocksPanel,
  relations: RelationsPanel,
  clues: CluesPanel,
  events: EventsPanel,
  combat: CombatPanel,
};
</script>
<template>
  <div class="workspace-panel">
    <component
      :is="components[game.view]"
      :key="game.module + ':' + game.slot + ':' + game.view"
    />
  </div>
</template>
<style scoped>
.workspace-panel {
  height: 100%;
  overflow-y: auto;
  padding: 0 2px 28px;
  min-height: 0;
}
</style>
