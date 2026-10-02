<script setup>
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";

import DiceCard from "./DiceCard.vue";
import Icon from "./Icon.vue";
import {
  abortTurn,
  canSend,
  currentLocation,
  game,
  sendAction,
  skipTyping,
} from "../store.js";

const emit = defineEmits(["skip"]);

const scroller = ref(null);
const pinned = ref(true);
const draft = ref("");
const inputEl = ref(null);

const hasStream = computed(() => game.stream.length > 0);
const location = computed(() => currentLocation());
const quickActions = computed(() =>
  (location.value?.actions || []).slice(0, 3),
);
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
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
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

watch(
  () => [game.module, game.slot],
  () => {
    draft.value = "";
    pinned.value = true;
  },
);
watch(
  () => game.view,
  (view) => {
    if (view === "adventure") scrollToEnd();
  },
);
// 地图与人物按钮投递行动草稿，等待玩家确认
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
  <section class="story-panel">
    <div class="story-heading">
      <span><Icon name="book" :size="16" />冒险记录</span>
      <div>
        <span v-if="game.loaded" class="story-place"
          >{{ game.state.character?.name }} · {{ game.state.location }}</span
        ><span class="tag subtle">{{
          game.turnStreaming
            ? "正在叙述"
            : game.loaded
              ? "自由行动"
              : "准备开始"
        }}</span>
      </div>
    </div>
    <div ref="scroller" class="stream" @scroll="onScroll">
      <div v-if="!hasStream" class="placeholder">
        <span class="welcome-symbol"><Icon name="compass" :size="44" /></span
        ><span class="welcome-eyebrow">一段新的旅程</span>
        <h2>
          {{
            game.moduleInfo?.title ||
            game.modules.find((module) => module.dir === game.module)?.title ||
            "你的故事，即将展开"
          }}
        </h2>
        <p>
          {{
            game.moduleInfo?.intro ||
            "选择冒险本与角色，让故事从你的第一个决定开始。"
          }}
        </p>
        <button
          v-if="!game.loaded"
          class="primary-button"
          :disabled="game.loading || game.busy"
          @click="game.sessionsOpen = true"
        >
          <Icon name="plus" :size="16" />选择或新建存档
        </button>
        <p v-else class="welcome-hint">写下你想做的事，决定故事的下一步。</p>
      </div>
      <div v-else class="entries">
        <template v-for="entry in game.stream" :key="entry.id">
          <article
            v-if="entry.kind === 'narrative'"
            class="entry narrative"
            :class="{ dim: entry.dim, streaming: entry.streaming }"
          >
            <div v-if="!entry.dim" class="narrative-author">
              <span class="author-mark"
                ><Icon name="sparkles" :size="12" /></span
              >{{ entry.source === "opening" ? "故事开场" : "主持人" }}
            </div>
            <div class="narrative-text">
              {{ entry.text }}<span v-if="entry.streaming" class="caret"></span>
            </div>
          </article>
          <article
            v-else-if="entry.kind === 'action'"
            class="entry player-action"
          >
            <span class="action-mark">{{
              game.state?.character?.name?.slice(0, 1) || "你"
            }}</span>
            <div>
              <span class="player-label">你的行动</span>
              <p>{{ entry.text }}</p>
            </div>
          </article>
          <div v-else-if="entry.kind === 'dice'" class="entry">
            <DiceCard :result="entry.result" />
          </div>
          <figure v-else-if="entry.kind === 'image'" class="entry figure">
            <button
              class="figure-image"
              title="放大剧情插图"
              @click="game.lightbox = entry"
            >
              <img
                :src="entry.url"
                :alt="entry.prompt || '剧情插图'"
                loading="lazy"
              /><span><Icon name="image" :size="14" />查看插图</span>
            </button>
            <figcaption v-if="entry.prompt">{{ entry.prompt }}</figcaption>
          </figure>
          <div v-else-if="entry.kind === 'system'" class="entry system">
            <Icon name="compass" :size="14" /><span>{{ entry.text }}</span>
          </div>
          <div
            v-else
            class="entry note"
            :class="'note-' + (entry.level || 'info')"
          >
            <Icon
              :name="
                entry.level === 'error' || entry.level === 'warn'
                  ? 'activity'
                  : entry.level === 'settle'
                    ? 'check'
                    : 'book'
              "
              :size="13"
            /><span>{{ entry.text }}</span>
          </div>
        </template>
      </div>
    </div>
    <div v-if="!pinned && hasStream" class="jump-wrap">
      <button class="secondary-button" @click="onJumpBottom">↓ 回到最新</button>
    </div>
    <button v-if="typingNow()" class="skip-button" @click="emit('skip')">
      跳过打字
    </button>
    <div class="action-area">
      <div v-if="game.suggestions.length" class="suggestion-area">
        <span class="action-label">接下来可以</span>
        <div class="suggestions">
          <button
            v-for="(suggestion, index) in game.suggestions"
            :key="index"
            :title="suggestion"
            :disabled="!canSend()"
            @click="useSuggestion(suggestion)"
          >
            <span class="suggestion-index">{{
              String(index + 1).padStart(2, "0")
            }}</span
            ><span>{{ suggestion }}</span
            ><Icon name="chevron" :size="14" />
          </button>
        </div>
      </div>
      <div v-else-if="quickActions.length && game.loaded" class="quick-actions">
        <span class="action-label">地点行动</span
        ><button
          v-for="action in quickActions"
          :key="action"
          class="quick-action"
          :disabled="!canSend()"
          @click="
            useSuggestion(
              '在' + location.name + '：' + action.split('→')[0].trim(),
            )
          "
        >
          {{ action.split("→")[0].trim() }}<Icon name="plus" :size="11" />
        </button>
      </div>
      <div class="composer">
        <textarea
          ref="inputEl"
          v-model="draft"
          class="action-input"
          rows="2"
          aria-label="行动描述"
          :disabled="!game.loaded"
          :placeholder="
            game.loading
              ? '正在同步存档…'
              : game.loaded
                ? '你想做什么？写下行动，或者选择上方建议…'
                : '先选择或创建一个存档，开始你的故事…'
          "
          @keydown="onKeydown"
        /><button
          v-if="game.turnStreaming"
          class="stop-button"
          title="停止接收剧情，结算完成后同步存档"
          @click="abortTurn"
        >
          停止显示</button
        ><button
          v-else
          class="send-button"
          :disabled="!canSubmit"
          aria-label="执行行动"
          @click="submit"
        >
          <Icon name="arrow" :size="20" />
        </button>
      </div>
      <div class="composer-hint">
        <span
          >Enter 行动<span class="hint-separator">·</span>Shift + Enter
          换行</span
        ><span>{{ game.busy ? "等待当前行动完成" : "由你决定下一步" }}</span>
      </div>
    </div>
  </section>
</template>
<style scoped>
.story-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  position: relative;
  background: var(--ink-820);
  border: 1px solid var(--line-soft);
  border-radius: 14px;
  overflow: hidden;
}
.story-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 22px;
  border-bottom: 1px solid var(--line-soft);
  font-size: 12px;
  flex-shrink: 0;
}
.story-heading > span,
.story-heading > div {
  display: flex;
  align-items: center;
  gap: 9px;
}
.story-heading > span > svg {
  color: var(--text-faint);
}
.story-place {
  font-size: 10px;
  color: var(--text-faint);
}
.stream {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 26px 32px 20px;
  scroll-behavior: smooth;
}
.entries {
  max-width: 760px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  max-width: 520px;
  margin: 4vh auto;
  color: var(--text-dim);
  padding: 22px 8px;
}
.welcome-symbol {
  display: grid;
  place-items: center;
  width: 90px;
  height: 90px;
  border-radius: 50%;
  border: 1px solid #b6934930;
  background: radial-gradient(ellipse at 50% 40%, #e2b56312, transparent);
  color: var(--brass-dim);
}
.welcome-eyebrow {
  font-size: 10px;
  color: var(--text-faint);
  margin-top: 24px;
  letter-spacing: 0.1em;
}
.placeholder h2 {
  font-family: var(--serif);
  font-size: 25px;
  font-weight: 500;
  color: var(--text);
  margin: 10px 0 16px;
}
.placeholder p {
  font-size: 12px;
  line-height: 2;
}
.placeholder .primary-button {
  margin-top: 18px;
}
.welcome-hint {
  color: var(--text-faint);
}
.narrative-author {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 10px;
  color: var(--text-faint);
  margin-bottom: 10px;
}
.author-mark {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  background: var(--brass-wash);
  border: 1px solid #ba974a26;
  border-radius: 6px;
  color: var(--brass);
}
.narrative-text {
  font-family: var(--serif);
  font-size: 15px;
  line-height: 2.12;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: #d4dfdb;
}
.narrative.dim .narrative-text {
  font-size: 13px;
  color: var(--text-dim);
  line-height: 1.95;
}
.caret {
  display: inline-block;
  width: 5px;
  height: 15px;
  vertical-align: -2px;
  margin-left: 4px;
  background: var(--brass);
  animation: pulse 1s steps(2) infinite;
}
.player-action {
  display: flex;
  gap: 12px;
  padding: 16px;
  border: 1px solid #c5a0522b;
  border-radius: 10px;
  background: var(--brass-wash);
}
.action-mark {
  width: 29px;
  height: 29px;
  border-radius: 8px;
  background: #ad954021;
  display: grid;
  place-items: center;
  color: var(--brass);
  font-family: var(--serif);
  font-size: 14px;
  flex-shrink: 0;
}
.player-label {
  font-size: 10px;
  color: var(--brass);
}
.player-action p {
  font-size: 13px;
  line-height: 1.85;
  margin: 5px 0 0;
  color: var(--text);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.figure {
  margin: 0;
  border: 1px solid var(--line);
  border-radius: 11px;
  overflow: hidden;
  background: var(--ink-860);
}
.figure-image {
  display: block;
  width: 100%;
  padding: 0;
  position: relative;
  border: 0;
  background: none;
  cursor: zoom-in;
}
.figure-image img {
  width: 100%;
  max-height: 420px;
  object-fit: cover;
  display: block;
}
.figure-image > span {
  display: flex;
  gap: 6px;
  align-items: center;
  position: absolute;
  right: 12px;
  bottom: 12px;
  font-size: 10px;
  background: #10181ccc;
  padding: 5px 8px;
  border-radius: 5px;
  color: var(--text);
}
.figure figcaption {
  padding: 10px 14px;
  font-size: 10px;
  color: var(--text-faint);
  line-height: 1.8;
  max-height: 80px;
  overflow: auto;
}
.system {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 11px;
  color: var(--text-dim);
}
.system > svg {
  color: var(--brass);
}
.note {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  font-size: 11px;
  line-height: 1.9;
  color: var(--text-faint);
  padding: 7px 10px;
  border-radius: 6px;
}
.note > svg {
  margin-top: 4px;
  flex-shrink: 0;
}
.note-settle {
  background: #7ca6c50a;
  color: #9ab4bc;
}
.note-warn {
  background: #e2b5630a;
  color: var(--ember);
}
.note-error {
  border: 1px solid #df8a8038;
  background: #df8a8009;
  color: var(--blood);
}
.jump-wrap {
  position: absolute;
  bottom: 180px;
  left: 50%;
  transform: translateX(-50%);
}
.jump-wrap > button {
  box-shadow: var(--shadow-lift);
}
.skip-button {
  position: absolute;
  top: 15px;
  right: 20px;
  border: 0;
  background: var(--ink-740);
  font-size: 9px;
  padding: 3px 7px;
  color: var(--brass);
  border-radius: 5px;
}
.action-area {
  border-top: 1px solid var(--line-soft);
  padding: 15px 20px 11px;
  background: var(--ink-860);
  flex-shrink: 0;
}
.action-label {
  font-size: 10px;
  color: var(--text-faint);
}
.suggestion-area > .action-label {
  display: block;
  margin-bottom: 8px;
}
.suggestions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 7px;
  margin-bottom: 12px;
}
.suggestions > button {
  display: flex;
  gap: 9px;
  align-items: center;
  text-align: left;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--ink-820);
  padding: 8px 10px;
  font-size: 11px;
  color: var(--text-dim);
  line-height: 1.7;
}
.suggestions > button > span:nth-child(2) {
  flex: 1;
  min-width: 0;
}
.suggestions > button > svg {
  flex-shrink: 0;
  color: var(--text-faint);
}
.suggestion-index {
  font-size: 9px;
  color: var(--brass-dim);
}
.suggestions > button:hover:not(:disabled) {
  border-color: var(--brass-dim);
  color: var(--text);
}
.quick-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.quick-action {
  display: flex;
  gap: 9px;
  align-items: center;
  padding: 4px 8px;
  background: var(--ink-820);
  border: 1px solid var(--line);
  border-radius: 6px;
  font-size: 10px;
  color: var(--text-dim);
}
.composer {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  border: 1px solid var(--line-bright);
  border-radius: 10px;
  padding: 10px;
  background: var(--ink-900);
}
.composer:focus-within {
  border-color: var(--brass-dim);
  box-shadow: 0 0 0 2px var(--brass-wash);
}
.action-input {
  flex: 1;
  min-width: 0;
  resize: none;
  min-height: 48px;
  max-height: 140px;
  border: 0;
  outline: none;
  background: none;
  color: var(--text);
  font-family: var(--sans);
  font-size: 12px;
  line-height: 1.9;
  padding: 2px 3px;
}
.action-input::placeholder {
  color: var(--text-faint);
}
.send-button {
  width: 35px;
  height: 35px;
  border: 0;
  border-radius: 7px;
  background: var(--brass);
  color: #20190e;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}
.stop-button {
  padding: 7px 9px;
  border: 1px solid #dc8a7b60;
  color: var(--blood);
  border-radius: 7px;
  font-size: 10px;
  background: none;
  flex-shrink: 0;
}
.composer-hint {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: 9px;
  color: var(--text-faint);
  margin: 8px 2px 0;
}
.hint-separator {
  margin: 0 7px;
}
@media (min-width: 1700px) {
  .stream {
    padding: 30px 42px;
  }
  .action-area {
    padding: 18px 24px 12px;
  }
}
@media (max-width: 1250px) {
  .stream {
    padding: 22px 24px;
  }
  .suggestions {
    grid-template-columns: 1fr;
    max-height: 157px;
    overflow-y: auto;
  }
}
@media (max-width: 650px) {
  .story-heading {
    padding: 13px 16px;
  }
  .stream {
    padding: 20px 18px;
  }
  .narrative-text {
    font-size: 14px;
    line-height: 2.05;
  }
  .action-area {
    padding: 12px 12px 9px;
  }
  .suggestions {
    grid-template-columns: 1fr;
    max-height: 144px;
  }
  .composer-hint {
    font-size: 8px;
  }
  .story-place {
    display: none;
  }
  .placeholder {
    margin: 0 auto;
    padding: 25px 8px;
  }
  .placeholder h2 {
    font-size: 22px;
  }
  .welcome-symbol {
    width: 70px;
    height: 70px;
  }
}
</style>
