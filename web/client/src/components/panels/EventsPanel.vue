<script setup>
import { computed, ref } from "vue";
import Icon from "../Icon.vue";
import { game } from "../../store.js";
const fired = computed(() => game.state?.events_fired || []);
const log = computed(() => (game.state?.log || []).slice(-40).reverse());
const pending = computed(() => {
  const events = [
    ...(Array.isArray(game.state?.pending_events)
      ? game.state.pending_events
      : []),
    game.state?.pending_event,
  ].filter(Boolean);
  return events.filter(
    (event, index) =>
      events.findIndex(
        (other) => (other.code || other.name) === (event.code || event.name),
      ) === index,
  );
});
const showDeck = ref(false),
  showLog = ref(true),
  query = ref("");
const knownCodes = computed(
  () =>
    new Set(
      [...fired.value, ...pending.value].map((event) => String(event.code)),
    ),
);
const deck = computed(() =>
  (game.events || []).filter((event) =>
    knownCodes.value.has(String(event.code)),
  ),
);
const firedCodes = computed(
  () => new Set(fired.value.map((event) => String(event.code))),
);
const filteredDeck = computed(() =>
  deck.value.filter((event) =>
    (event.code + " " + event.name).includes(query.value.trim()),
  ),
);
const logIcon = (type) =>
  type === "移动"
    ? "map"
    : type === "事件"
      ? "activity"
      : type === "行动"
        ? "compass"
        : "book";
</script>
<template>
  <div v-if="!game.loaded" class="empty-hint">
    冒险事件、地点移动与故事记录会沿时间线排列在这里。
  </div>
  <template v-else>
    <div class="event-stats">
      <div>
        <Icon name="activity" :size="22" /><span
          ><b>{{ pending.length }}</b
          >待处理事件</span
        >
      </div>
      <div>
        <Icon name="check" :size="22" /><span
          ><b>{{ fired.length }}</b
          >已触发事件</span
        >
      </div>
      <div>
        <Icon name="book" :size="22" /><span
          ><b>{{ game.state.log?.length || 0 }}</b
          >冒险记录</span
        >
      </div>
    </div>
    <div class="events-layout">
      <section class="card event-history">
        <div class="event-section-head">
          <h3 class="section-label">冒险时间线</h3>
          <button class="text-button" @click="showLog = !showLog">
            {{ showLog ? "收起日志" : "展开日志" }}
          </button>
        </div>
        <ol v-if="showLog" class="timeline">
          <li v-for="(entry, index) in log" :key="index">
            <span class="timeline-icon"
              ><Icon :name="logIcon(entry.type)" :size="14"
            /></span>
            <div class="timeline-content">
              <div>
                <span class="timeline-type">{{ entry.type || "记录" }}</span
                ><small>第 {{ entry.day }} 天 · {{ entry.period }}</small>
              </div>
              <p>{{ entry.text }}</p>
            </div>
          </li>
          <li v-if="!log.length" class="empty-hint">还没有冒险记录。</li>
        </ol>
        <p v-if="showLog && game.state.log?.length > 40" class="hint">
          当前展示最近 40 条记录。
        </p>
      </section>
      <div class="events-side">
        <section
          v-for="event in pending"
          :key="event.code || event.name"
          class="card pending-card"
        >
          <span class="tag gold">等待处理</span>
          <h3>{{ event.name || "待处理事件" }}</h3>
          <span v-if="event.code" class="event-code"
            >事件 {{ event.code }}</span
          >
          <p>下一回合会将这件事带入故事，留意它的发展。</p>
        </section>
        <section class="card">
          <h3 class="section-label">已触发事件</h3>
          <div class="fired-events">
            <div
              v-for="(event, index) in [...fired].reverse()"
              :key="index"
              class="fired-event"
            >
              <span class="event-code">{{ event.code || "—" }}</span
              ><span
                ><b>{{ event.name }}</b
                ><small>第 {{ event.day }} 天</small></span
              ><Icon name="check" :size="14" />
            </div>
            <div v-if="!fired.length" class="soft-empty">
              尚未触发事件牌，继续探索会带来新的变化。
            </div>
          </div>
        </section>
      </div>
    </div>
    <section class="card event-deck">
      <div class="event-section-head">
        <h3 class="section-label">
          已解锁事件<span class="tag subtle">{{ deck.length }}</span>
        </h3>
        <button
          v-if="deck.length"
          class="text-button"
          @click="showDeck = !showDeck"
        >
          {{ showDeck ? "收起记录" : "查看记录" }}
        </button>
      </div>
      <p v-if="!deck.length" class="hint">
        事件在游戏中实际触发后，会进入这里的记录。
      </p>
      <template v-if="showDeck && deck.length"
        ><div class="deck-search">
          <Icon name="search" :size="14" /><input
            v-model="query"
            aria-label="搜索事件牌"
            placeholder="搜索编号或名称…"
          />
        </div>
        <div class="deck-grid">
          <article
            v-for="event in filteredDeck"
            :key="event.code + '-' + event.name"
            class="deck-entry"
            :class="{ used: firedCodes.has(String(event.code)) }"
          >
            <span class="event-code">{{ event.code }}</span
            ><b>{{ event.name }}</b
            ><span class="tag subtle">{{
              firedCodes.has(String(event.code))
                ? "已触发"
                : event.special
                  ? "特殊事件"
                  : "等待处理"
            }}</span>
          </article>
          <p v-if="!filteredDeck.length" class="hint">没有匹配的事件牌。</p>
        </div></template
      >
    </section>
  </template>
</template>
<style scoped>
.event-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 15px;
  margin-bottom: 22px;
}
.event-stats > div {
  display: flex;
  align-items: center;
  gap: 15px;
  background: var(--ink-820);
  border: 1px solid var(--line-soft);
  border-radius: 11px;
  padding: 17px;
  color: var(--text-faint);
}
.event-stats span {
  font-size: 11px;
}
.event-stats b {
  display: block;
  font-size: 26px;
  color: var(--text);
  font-weight: 600;
  line-height: 1.4;
}
.events-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}
.event-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.event-section-head .section-label {
  flex: 1;
  margin: 0;
}
.event-section-head .text-button {
  white-space: nowrap;
}
.timeline {
  list-style: none;
  margin: 24px 0 0;
  padding: 0;
}
.timeline li {
  display: flex;
  gap: 15px;
  position: relative;
  padding-bottom: 23px;
}
.timeline li::before {
  content: "";
  position: absolute;
  left: 13px;
  top: 28px;
  bottom: 0;
  width: 1px;
  background: var(--line);
}
.timeline li:last-child::before {
  display: none;
}
.timeline-icon {
  flex-shrink: 0;
  width: 27px;
  height: 27px;
  border-radius: 50%;
  background: var(--ink-740);
  border: 1px solid var(--line);
  display: grid;
  place-items: center;
  color: var(--brass);
}
.timeline-content {
  flex: 1;
  min-width: 0;
}
.timeline-content > div {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 3px 0 8px;
}
.timeline-type {
  font-size: 10px;
  color: var(--text-dim);
}
.timeline-content small {
  font-size: 10px;
  color: var(--text-faint);
}
.timeline-content p {
  font-size: 12px;
  line-height: 1.95;
  color: var(--text-dim);
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.events-side {
  display: grid;
  gap: 16px;
}
.pending-card {
  border-color: #bd98524d;
  background: var(--brass-wash);
}
.pending-card h3 {
  font-size: 15px;
  margin: 13px 0 7px;
}
.pending-card p {
  font-size: 11px;
  color: var(--text-dim);
  line-height: 1.8;
  margin-bottom: 0;
}
.event-code {
  font-size: 10px;
  color: var(--brass);
}
.fired-event {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--line-soft);
}
.fired-event:last-child {
  border-bottom: 0;
}
.fired-event > span:nth-child(2) {
  flex: 1;
  min-width: 0;
}
.fired-event b {
  font-size: 12px;
  font-weight: 500;
  display: block;
}
.fired-event small {
  font-size: 10px;
  color: var(--text-faint);
}
.fired-event > svg {
  color: var(--moss);
}
.soft-empty {
  font-size: 12px;
  color: var(--text-faint);
  line-height: 1.85;
}
.event-deck {
  margin-top: 20px;
}
.deck-search {
  display: flex;
  gap: 9px;
  align-items: center;
  color: var(--text-faint);
  border: 1px solid var(--line);
  border-radius: 7px;
  padding: 8px 11px;
  margin: 20px 0 15px;
  max-width: 320px;
}
.deck-search input {
  background: none;
  border: 0;
  outline: none;
  color: var(--text);
  width: 100%;
  min-width: 0;
  font-size: 12px;
}
.deck-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.deck-entry {
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 9px;
}
.deck-entry b {
  font-size: 12px;
  line-height: 1.75;
  font-weight: 500;
}
.deck-entry.used {
  background: #80b39406;
  border-color: #80b39435;
}
@media (max-width: 1000px) {
  .events-layout {
    grid-template-columns: 1.4fr 1fr;
  }
  .deck-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 650px) {
  .events-layout {
    grid-template-columns: 1fr;
  }
  .event-stats {
    gap: 8px;
  }
  .event-stats > div {
    flex-direction: column;
    align-items: flex-start;
    padding: 13px;
    gap: 7px;
  }
  .event-stats b {
    font-size: 22px;
  }
  .deck-grid {
    grid-template-columns: 1fr;
  }
}
</style>
