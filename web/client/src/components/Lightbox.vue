<script setup>
import { onBeforeUnmount, onMounted } from "vue";

defineProps({
  src: { type: String, required: true },
  prompt: { type: String, default: "" },
});
const emit = defineEmits(["close"]);

function onKey(e) {
  if (e.key === "Escape") emit("close");
}

onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <div class="lightbox" @click.self="emit('close')">
    <button class="close" title="关闭（Esc）" @click="emit('close')">✕</button>
    <figure @click.stop>
      <img :src="src" :alt="prompt || '插图'" />
      <figcaption v-if="prompt">{{ prompt }}</figcaption>
    </figure>
  </div>
</template>

<style scoped>
.lightbox {
  position: fixed;
  inset: 0;
  z-index: 3500;
  background: rgba(5, 6, 8, 0.93);
  display: grid;
  place-items: center;
  padding: 4vh 4vw;
  animation: fade 0.2s ease;
}
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }

figure { margin: 0; max-width: 100%; max-height: 100%; display: flex; flex-direction: column; gap: 10px; }
img {
  max-width: 100%;
  max-height: 86vh;
  object-fit: contain;
  border-radius: 12px;
  border: 1px solid var(--line);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.7);
}
figcaption {
  text-align: center;
  font-size: 12.5px;
  color: var(--text-faint);
  font-style: italic;
  line-height: 1.8;
  max-width: 46rem;
}
.close {
  position: absolute;
  top: 18px;
  right: 22px;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  border: 1px solid var(--line);
  background: #1a2028;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 15px;
}
.close:hover { color: var(--brass); border-color: var(--brass-dim); }
</style>
