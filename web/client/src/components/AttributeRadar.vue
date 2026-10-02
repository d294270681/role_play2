<script setup>
import { computed } from "vue";
import { ATTRS } from "../util.js";
import { clamp } from "../ui.js";
const props = defineProps({
  attributes: { type: Object, default: () => ({}) },
});
const point = (index, r) => {
  const a = ((index * 60 - 90) * Math.PI) / 180;
  return [140 + Math.cos(a) * r, 135 + Math.sin(a) * r];
};
const ring = (r) => ATTRS.map((_, i) => point(i, r).join(",")).join(" ");
const values = computed(() =>
  ATTRS.map((name, i) =>
    point(i, (clamp(props.attributes[name], 0, 5) / 5) * 82).join(","),
  ).join(" "),
);
const description = computed(() =>
  ATTRS.map((name) => name + " " + (props.attributes[name] || 0)).join("，"),
);
</script>
<template>
  <svg
    viewBox="0 0 280 276"
    role="img"
    :aria-label="'六属性雷达图：' + description"
    class="radar"
  >
    <polygon
      v-for="level in 5"
      :key="level"
      :points="ring((level * 82) / 5)"
      class="radar-grid"
    />
    <line
      v-for="(_, i) in ATTRS"
      :key="i"
      x1="140"
      y1="135"
      :x2="point(i, 82)[0]"
      :y2="point(i, 82)[1]"
      class="radar-axis"
    />
    <polygon :points="values" class="radar-value" />
    <circle
      v-for="(name, i) in ATTRS"
      :key="name"
      :cx="point(i, (clamp(attributes[name], 0, 5) / 5) * 82)[0]"
      :cy="point(i, (clamp(attributes[name], 0, 5) / 5) * 82)[1]"
      r="3.5"
      class="radar-dot"
    />
    <text
      v-for="(name, i) in ATTRS"
      :key="name"
      :x="point(i, 112)[0]"
      :y="point(i, 112)[1]"
      text-anchor="middle"
      dominant-baseline="middle"
    >
      {{ name }}
      <tspan>{{ attributes[name] || 0 }}</tspan>
    </text>
  </svg>
</template>
<style scoped>
.radar {
  width: 100%;
  max-width: 320px;
  display: block;
  margin: auto;
}
.radar-grid {
  fill: none;
  stroke: var(--line);
  stroke-width: 1;
}
.radar-axis {
  stroke: var(--line);
  stroke-dasharray: 3 4;
}
.radar-value {
  fill: rgba(226, 181, 99, 0.16);
  stroke: var(--brass);
  stroke-width: 2;
  stroke-linejoin: round;
}
.radar-dot {
  fill: var(--brass);
}
text {
  fill: var(--text-dim);
  font-size: 12px;
  font-family: var(--sans);
}
tspan {
  fill: var(--text);
  font-weight: 700;
}
</style>
