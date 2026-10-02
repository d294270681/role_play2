<script setup>
import { computed } from "vue";
import { clamp, clockArc } from "../ui.js";
const props = defineProps({
  value: { type: Number, default: 0 },
  max: { type: Number, default: 6 },
  label: { type: String, default: "进度" },
  size: { type: [Number, String], default: 84 },
});
const count = computed(() => Math.max(1, Math.round(props.max)));
const progress = computed(() =>
  clamp((props.value / count.value) * 100, 0, 100),
);
</script>
<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 100 100"
    role="img"
    :aria-label="label + '，' + value + '/' + max"
    class="clock-dial"
    :class="{ complete: value >= max }"
  >
    <template v-if="count <= 24">
      <path
        v-for="i in count"
        :key="i"
        :d="clockArc(i - 1, count)"
        :class="{ filled: i <= value }"
      />
    </template>
    <template v-else>
      <circle
        cx="50"
        cy="50"
        r="38"
        fill="none"
        stroke="var(--line)"
        stroke-width="10"
      />
      <circle
        cx="50"
        cy="50"
        r="38"
        fill="none"
        stroke="var(--brass)"
        stroke-width="10"
        pathLength="100"
        :stroke-dasharray="progress + ' 100'"
        transform="rotate(-90 50 50)"
      />
    </template>
    <text x="50" y="49" text-anchor="middle" class="value">{{ value }}</text>
    <text x="50" y="65" text-anchor="middle" class="max">/ {{ max }}</text>
  </svg>
</template>
<style scoped>
.clock-dial path {
  fill: var(--ink-740);
  stroke: var(--line);
  stroke-width: 0.6;
  transition: fill 0.2s;
}
.clock-dial .filled {
  fill: var(--brass);
  stroke: var(--brass);
}
.clock-dial.complete .filled {
  fill: var(--blood);
  stroke: var(--blood);
}
.value {
  fill: var(--text);
  font-size: 23px;
  font-weight: 650;
  font-family: var(--sans);
}
.max {
  fill: var(--text-dim);
  font-size: 12px;
  font-family: var(--sans);
}
</style>
