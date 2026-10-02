<script setup>
defineProps({
  name: { type: String, default: "sparkles" },
  size: { type: [Number, String], default: 20 },
});
const paths = {
  compass: [
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z",
    "m16 8-2.5 5.5L8 16l2.5-5.5L16 8Z",
  ],
  user: [
    "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
    "M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2",
  ],
  map: ["m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z", "M9 3v15M15 6v15"],
  backpack: [
    "M8 7V5a4 4 0 0 1 8 0v2",
    "M8 6h8a5 5 0 0 1 5 5v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a5 5 0 0 1 5-5Z",
    "M7 14h10v5H7v-5ZM7 10h10",
  ],
  target: ["M12 3a9 9 0 1 0 9 9", "M12 7a5 5 0 1 0 5 5", "m12 12 8-8M15 4h5v5"],
  users: [
    "M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
    "M2 21v-3a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v3M17 3a4 4 0 0 1 0 8M20 14a5 5 0 0 1 2 4v3",
  ],
  search: ["M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Z", "m16 16 5 5"],
  book: [
    "M4 3h7l1 2 1-2h7v17h-7l-1 1-1-1H4V3Z",
    "M12 5v16M7 7h2M15 7h2M7 11h2M15 11h2",
  ],
  swords: [
    "m3 3 7 2 11 14-2 2L5 10 3 3Z",
    "m21 3-7 2-4 5M14 14l-5 7-2-2 5-7M3 16l5 5M16 3l5 5",
  ],
  heart: [
    "M20.5 4.5a5 5 0 0 0-7.1 0L12 6l-1.4-1.5a5 5 0 0 0-7.1 7.1L12 21l8.5-9.4a5 5 0 0 0 0-7.1Z",
  ],
  bolt: ["m13 2-9 12h7l-1 8 10-13h-8l1-7Z"],
  shield: ["m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6l8-4Z"],
  activity: ["M2 12h5l3-9 4 18 3-9h5"],
  sparkles: ["m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"],
  settings: [
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
    "m9 2-1 3-3 1-3-1-1 5 3 2v3l-3 2 3 4 3-2 3 2 1 3h5l1-3 3-1 3 1 1-5-3-2v-3l3-2-3-4-3 2-3-2-1-3H9Z",
  ],
  menu: ["M4 6h16M4 12h16M4 18h16"],
  chevron: ["m9 5 7 7-7 7"],
  arrow: ["M4 12h16m-6-6 6 6-6 6"],
  close: ["m6 6 12 12M18 6 6 18"],
  plus: ["M12 4v16M4 12h16"],
  save: ["M4 3h13l4 4v14H3V3h1ZM7 3v6h10V3M7 21v-8h10v8"],
  moon: ["M20 14a9 9 0 0 1-10-10 9 9 0 1 0 10 10Z"],
  sun: [
    "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10ZM12 1v2M12 21v2M1 12h2M21 12h2M4 4l2 2M18 18l2 2M4 20l2-2M18 6l2-2",
  ],
  pin: [
    "M19 10c0 5-7 12-7 12S5 15 5 10a7 7 0 0 1 14 0ZM12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
  ],
  coin: [
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM15 8H10a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H9M12 6v12",
  ],
  check: ["m5 12 4 4L19 6"],
  image: ["M3 3h18v18H3V3ZM3 17l6-6 4 4 3-3 5 5M8 6h.01"],
  refresh: [
    "M20 8a8 8 0 0 0-14-3L3 8M3 3v5h5M4 16a8 8 0 0 0 14 3l3-3M16 16h5v5",
  ],
};
</script>
<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.65"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="ui-icon"
  >
    <path v-for="(d, i) in paths[name] || paths.sparkles" :key="i" :d="d" />
  </svg>
</template>
<style scoped>
.ui-icon {
  flex-shrink: 0;
  vertical-align: middle;
}
</style>
