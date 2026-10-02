<script setup>
import { computed } from "vue";
import Icon from "./Icon.vue";
import { gaugePercent } from "../util.js";
import { gaugeMeta } from "../ui.js";
const props = defineProps({
  name: { type: String, required: true },
  gauge: { type: Object, default: () => ({ value: 0, max: 0 }) },
  compact: Boolean,
});
const meta = computed(() => gaugeMeta(props.name));
</script>
<template>
  <div
    class="meter"
    :class="{ compact }"
    :style="{ '--meter-color': meta.color }"
  >
    <div class="meter-heading">
      <span class="meter-label"
        ><Icon :name="meta.icon" :size="16" />{{ name }}</span
      ><span class="meter-value"
        >{{ gauge.value ?? 0 }}<small> / {{ gauge.max ?? 0 }}</small></span
      >
    </div>
    <div
      class="meter-track"
      role="meter"
      :aria-label="name"
      :aria-valuemin="0"
      :aria-valuemax="gauge.max || 0"
      :aria-valuenow="gauge.value || 0"
    >
      <div :style="{ width: gaugePercent(gauge) + '%' }" />
    </div>
  </div>
</template>
<style scoped>
.meter-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 9px;
}
.meter-label {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--text-dim);
  font-size: 12px;
}
.meter-label svg {
  color: var(--meter-color);
}
.meter-value {
  font-size: 19px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.meter-value small {
  color: var(--text-faint);
  font-size: 11px;
  font-weight: 400;
}
.meter-track {
  height: 6px;
  border-radius: 5px;
  background: var(--ink-950);
  overflow: hidden;
}
.meter-track > div {
  height: 100%;
  background: var(--meter-color);
  border-radius: 5px;
  transition: width 0.35s;
}
.compact .meter-heading {
  margin-bottom: 6px;
}
.compact .meter-value {
  font-size: 14px;
}
.compact .meter-track {
  height: 4px;
}
</style>
