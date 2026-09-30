<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import DiceCard from "./DiceCard.vue";
import { abortTurn, canSend, game, sendAction, skipTyping } from "../store.js";

const emit = defineEmits(["skip"]);

const scroller = ref(null);
const pinned = ref(true);
const draft = ref("");
const inputEl = ref(null);

const hasStream = computed(() => game.stream.length > 0);
const canSubmit = computed(() => Boolean(draft.value.trim()) && canSend());

/** 用户往上翻时暂停自动滚动。 */
function onScroll() {
  const el = scroller.value;
  if (!el) return;
  pinned.value = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
}

function scrollToEnd(force = false) {
  if (!force && !pinned.value) return;
  nextTick(() => {
    const el = scroller.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}

let observer = null;

/** 打字过程中内容高度持续变化，用 ResizeObserver 跟随到底部。 */
onMounted(() => {
  const el = scroller.value;
  if (!el) return;
  observer = new ResizeObserver(() => scrollToEnd());
  observer.observe(el);
  scrollToEnd(true);
});

onBeforeUnmount(() => {
  if (observer) observer.disconnect();
});

watch(
  () => game.stream.length,
  () => scrollToEnd(),
);
watch(
  () => game.stream.map((e) => e.text?.length || 0).join(","),
  () => scrollToEnd(),
);
watch(
  () => game.busy,
  (busy) => {
    if (busy) {
      pinned.value = true;
      scrollToEnd(true);
    }
  },
);

async function submit() {
  if (!canSubmit.value) return;
  const text = draft.value.trim();
  draft.value = "";
  pinned.value = true;
  await sendAction(text);
  nextTick(() => scrollToEnd(true));
}

function onKeydown(e) {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    submit();
  }
}

function onJumpBottom() {
  pinned.value = true;
  scrollToEnd(true);
}

function typingNow() {
  return game.stream.some((e) => e.kind === "narrative" && e.pending);
}

function useSuggestion(text) {
  draft.value = text;
  inputEl.value?.focus();
}

// 右栏「可用行动」按钮投递过来的行动，直接落到输入框等待确认
watch(
  () => game.pendingAction,
  (text) => {
    if (!text) return;
    draft.value = text;
    game.pendingAction = "";
    nextTick(() => {
      inputEl.value?.focus();
      scrollToEnd(true);
    });
  },
);
</script>

<template>
  <section class="stream-col">
    <div ref="scroller" class="stream" @scroll="onScroll">
      <div v-if="!hasStream" class="placeholder">
        <div class="ph-sigil">✦</div>
        <h2>{{ game.moduleInfo?.title || "还没有选定冒险" }}</h2>
        <p class="ph-intro">{{ game.moduleInfo?.intro || "在左侧选一本 RPG 本，并开一档存档。" }}</p>
        <p v-if="game.loaded" class="ph-sub">
          写下你要做的事，GM 会接住它。<br />
          规则判定由系统真掷骰，状态与线索会同步到右侧面板。
        </p>
        <p v-else class="ph-sub">左侧「＋ 新建存档」开一档，就能开始了。</p>
      </div>

      <div v-else class="entries">
        <template v-for="entry in game.stream" :key="entry.id">
          <!-- 叙述 -->
          <div v-if="entry.kind === 'narrative'" class="entry narrative" :class="{ dim: entry.dim, streaming: entry.streaming }">
            {{ entry.text }}<span v-if="entry.streaming" class="caret" />
          </div>

          <!-- 玩家行动 -->
          <div v-else-if="entry.kind === 'action'" class="entry action">
            <span class="you">你</span>
            <span class="said">{{ entry.text }}</span>
          </div>

          <!-- 判定 -->
          <div v-else-if="entry.kind === 'dice'" class="entry dice">
            <DiceCard :result="entry.result" />
          </div>

          <!-- 插图 -->
          <figure v-else-if="entry.kind === 'image'" class="entry figure">
            <img :src="entry.url" :alt="entry.prompt || '剧情插图'" loading="lazy" @click="game.lightbox = entry" />
            <figcaption v-if="entry.prompt">{{ entry.prompt }}</figcaption>
            <button class="zoom" title="放大" @click="game.lightbox = entry">⤢</button>
          </figure>

          <!-- 系统动作 -->
          <div v-else-if="entry.kind === 'system'" class="entry system">
            <span class="ico">◆</span>{{ entry.text }}
          </div>

          <!-- 系统条 -->
          <div v-else class="entry note" :class="`note-${entry.level || 'info'}`">
            <span class="ico">{{ entry.level === "error" ? "✕" : entry.level === "warn" ? "!" : entry.level === "settle" ? "Σ" : "·" }}</span>
            <span>{{ entry.text }}</span>
          </div>
        </template>
      </div>
    </div>

    <button v-if="!pinned && hasStream" class="jump" @click="onJumpBottom">↓ 回到最新</button>
    <button v-if="typingNow()" class="skip" @click="emit('skip')">跳过打字动画</button>

    <!-- 建议行动 -->
    <div v-if="game.suggestions.length" class="suggestions">
      <span class="sug-label">建议行动</span>
      <button v-for="(s, i) in game.suggestions" :key="i" class="sug" :disabled="!canSend()" @click="useSuggestion(s)">
        {{ s }}
      </button>
    </div>

    <!-- 输入 -->
    <div class="composer">
      <textarea
        ref="inputEl"
        v-model="draft"
        class="box"
        rows="2"
        :disabled="!game.loaded"
        :placeholder="game.loaded ? '写下你要做的事……（Enter 发送 / Shift+Enter 换行）' : '先在左侧开一档存档'"
        @keydown="onKeydown"
      />
      <div class="composer-side">
        <button v-if="game.busy" class="stop" @click="abortTurn">中止</button>
        <button v-else class="send" :disabled="!canSubmit" @click="submit">行动</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.stream-col {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  position: relative;
}

.stream {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 26px 34px 12px;
  scroll-behavior: smooth;
}

.placeholder {
  max-width: 40rem;
  margin: 12vh auto 0;
  text-align: center;
  color: var(--text-faint);
}
.ph-sigil { font-size: 30px; color: var(--brass-dim); }
.placeholder h2 { font-family: var(--serif); font-size: 24px; color: var(--text-dim); margin: 10px 0 6px; letter-spacing: 0.08em; }
.ph-intro { font-size: 13px; line-height: 1.9; }
.ph-sub { font-size: 12.5px; line-height: 2; margin-top: 14px; }

.entries {
  max-width: 47rem;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 13px;
}

.entry { animation: rise 0.26s ease; }
@keyframes rise {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
}

.narrative {
  font-family: var(--serif);
  font-size: 15px;
  line-height: 2.05;
  color: #dde3ec;
  white-space: pre-wrap;
  word-break: break-word;
  letter-spacing: 0.015em;
}
.narrative.dim { color: var(--text-faint); font-size: 13.5px; line-height: 1.9; }
.caret {
  display: inline-block;
  width: 7px;
  height: 15px;
  margin-left: 3px;
  vertical-align: -2px;
  background: var(--brass);
  animation: blink 1s steps(2, start) infinite;
}
@keyframes blink { to { visibility: hidden; } }

.action {
  display: flex;
  gap: 9px;
  align-items: baseline;
  margin: 4px 0 2px;
  padding-left: 11px;
  border-left: 2px solid var(--brass-dim);
  color: var(--text-dim);
  font-size: 14px;
  line-height: 1.85;
}
.action .you {
  font-size: 10.5px;
  letter-spacing: 0.14em;
  color: var(--brass-dim);
  flex-shrink: 0;
}
.action .said { font-family: var(--serif); }

.dice { margin: 4px 0; }

.figure {
  margin: 4px 0;
  position: relative;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--line);
  background: #0b0e12;
  box-shadow: var(--shadow-lift);
  cursor: zoom-in;
}
.figure img { display: block; width: 100%; max-height: 460px; object-fit: cover; }
.figure figcaption {
  padding: 7px 12px;
  font-size: 11.5px;
  color: var(--text-faint);
  background: #0e1218;
  border-top: 1px solid var(--line-soft);
  font-style: italic;
}
.figure .zoom {
  position: absolute;
  top: 9px;
  right: 9px;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(10, 12, 16, 0.72);
  color: #fff;
  cursor: pointer;
  font-size: 14px;
  opacity: 0;
  transition: opacity 0.18s;
}
.figure:hover .zoom { opacity: 1; }

.system {
  font-size: 12.5px;
  color: var(--text-dim);
  display: flex;
  gap: 7px;
  align-items: center;
}
.system .ico { color: var(--brass-dim); }

.note {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  font-size: 12px;
  line-height: 1.75;
  color: var(--text-faint);
  padding: 5px 10px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.018);
}
.note .ico { flex-shrink: 0; opacity: 0.85; }
.note-plain { opacity: 0.72; }
.note-settle { color: #9fb3cc; background: rgba(95, 149, 216, 0.07); }
.note-warn { color: #e0b479; background: rgba(217, 139, 58, 0.09); }
.note-error {
  color: #e59c98;
  background: rgba(194, 80, 76, 0.1);
  border: 1px solid rgba(194, 80, 76, 0.28);
}

.jump, .skip {
  position: absolute;
  border: 1px solid var(--line);
  background: #1a2028;
  color: var(--text-dim);
  border-radius: 14px;
  padding: 4px 12px;
  font-size: 11.5px;
  cursor: pointer;
  box-shadow: var(--shadow-lift);
}
.jump { bottom: 132px; left: 50%; transform: translateX(-50%); }
.skip { top: 12px; right: 22px; }
.jump:hover, .skip:hover { color: var(--brass); border-color: var(--brass-dim); }

.suggestions {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
  padding: 6px 34px 0;
  max-width: 47rem;
  margin: 0 auto;
  width: 100%;
}
.sug-label {
  font-size: 10.5px;
  letter-spacing: 0.16em;
  color: var(--text-faint);
  flex-shrink: 0;
}
.sug {
  padding: 5px 11px;
  border-radius: 15px;
  border: 1px solid var(--line);
  background: #161c24;
  color: var(--text-dim);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
  text-align: left;
}
.sug:hover:not(:disabled) { color: var(--brass); border-color: var(--brass-dim); background: #1c232d; }
.sug:disabled { opacity: 0.45; cursor: not-allowed; }

.composer {
  display: flex;
  gap: 10px;
  align-items: flex-end;
  padding: 12px 34px 18px;
  max-width: 47rem;
  margin: 0 auto;
  width: 100%;
}
.box {
  flex: 1;
  resize: none;
  min-height: 60px;
  max-height: 190px;
  padding: 11px 13px;
  border-radius: 11px;
  border: 1px solid var(--line);
  background: #10141a;
  color: var(--text);
  font-family: var(--serif);
  font-size: 14.5px;
  line-height: 1.75;
  outline: none;
  transition: border-color 0.16s, box-shadow 0.16s;
}
.box:focus { border-color: var(--brass-dim); box-shadow: 0 0 0 3px rgba(212, 169, 74, 0.1); }
.box:disabled { opacity: 0.5; }
.box::placeholder { color: var(--text-faint); }

.composer-side { flex-shrink: 0; }
.send, .stop {
  min-width: 74px;
  height: 60px;
  border-radius: 11px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  border: 1px solid var(--brass-dim);
  background: linear-gradient(180deg, #d4a94a, #b8913a);
  color: #1a1408;
  transition: all 0.15s;
}
.send:disabled { opacity: 0.35; cursor: not-allowed; }
.send:hover:not(:disabled) { filter: brightness(1.08); }
.stop {
  background: transparent;
  color: #e59c98;
  border-color: rgba(194, 80, 76, 0.5);
}
.stop:hover { background: rgba(194, 80, 76, 0.12); }
</style>
