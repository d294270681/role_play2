<script setup>
import { computed } from "vue";
import Icon from "../Icon.vue";
import { game, stageAction } from "../../store.js";
const clues = computed(() => game.state?.clues || []);
const active = computed(() => clues.value.filter((clue) => !clue.done));
const done = computed(() => clues.value.filter((clue) => clue.done));
const progress = computed(() =>
  clues.value.length
    ? Math.round((done.value.length / clues.value.length) * 100)
    : 0,
);
</script>
<template>
  <div v-if="!game.loaded" class="empty-hint">
    载入存档后，旅途中发现的线索会自动记录在这里。
  </div>
  <template v-else>
    <div class="panel-toolbar">
      <div class="clue-summary">
        <span
          ><b>{{ active.length }}</b
          >待追踪</span
        ><span
          ><b>{{ done.length }}</b
          >已解决</span
        >
        <div class="summary-progress">
          <i :style="{ width: progress + '%' }"></i>
        </div>
        <small>{{ progress }}%</small>
      </div>
      <p class="hint">新发现自动记录，调查解决后由剧情归档。</p>
    </div>
    <div class="clue-board">
      <section class="clue-column">
        <div class="column-heading">
          <span class="column-dot"></span>
          <h3>正在追踪</h3>
          <span>{{ active.length }}</span>
        </div>
        <article
          v-for="(clue, index) in active"
          :key="index + ':' + clue.text"
          class="clue-card"
        >
          <div class="clue-card-top">
            <span>线索 {{ String(index + 1).padStart(2, "0") }}</span>
          </div>
          <p>{{ clue.text }}</p>
          <button
            class="clue-complete"
            :disabled="game.busy"
            :aria-label="'调查线索' + clue.text"
            @click="stageAction('调查线索：' + clue.text)"
          >
            <Icon name="search" :size="14" />沿这条线索调查<Icon
              name="arrow"
              :size="14"
            />
          </button>
        </article>
        <div v-if="!active.length" class="empty-column">
          <Icon name="search" :size="28" />
          <p>
            {{
              done.length
                ? "目前已发现的线索均已解决，继续探索寻找新发现。"
                : "还没有发现线索。调查地点或与人物交谈，会带来新的发现。"
            }}
          </p>
        </div>
      </section>
      <section class="clue-column completed">
        <div class="column-heading">
          <span class="column-dot"></span>
          <h3>已解决</h3>
          <span>{{ done.length }}</span>
        </div>
        <article
          v-for="(clue, index) in done"
          :key="index + ':' + clue.text"
          class="clue-card"
        >
          <div class="clue-card-top">
            <span><Icon name="check" :size="12" />已解决</span>
          </div>
          <p>{{ clue.text }}</p>
          <span class="hint">结果已随冒险记录保存。</span>
        </article>
        <div v-if="!done.length" class="empty-column">
          <Icon name="check" :size="28" />
          <p>查明或解决的线索会在这里归档。</p>
        </div>
      </section>
    </div>
  </template>
</template>
<style scoped>
.clue-summary {
  display: flex;
  align-items: center;
  gap: 22px;
  color: var(--text-faint);
  font-size: 11px;
}
.clue-summary > span {
  white-space: nowrap;
}
.clue-summary b {
  font-size: 22px;
  color: var(--text);
  margin-right: 7px;
  font-weight: 600;
}
.summary-progress {
  height: 4px;
  width: 80px;
  background: var(--ink-740);
  border-radius: 4px;
  overflow: hidden;
}
.summary-progress i {
  height: 100%;
  display: block;
  background: var(--moss);
}
.clue-summary small {
  font-size: 10px;
  margin-left: -14px;
}

.clue-board {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 22px;
  align-items: start;
}
.clue-column {
  background: var(--ink-860);
  border: 1px solid var(--line-soft);
  border-radius: 13px;
  padding: 17px;
  min-height: 380px;
}
.column-heading {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 18px;
}
.column-heading h3 {
  font-size: 13px;
  font-weight: 500;
  margin: 0;
  flex: 1;
}
.column-heading > span:last-child {
  font-size: 10px;
  color: var(--text-faint);
}
.column-dot {
  height: 6px;
  width: 6px;
  border-radius: 50%;
  background: var(--brass);
}
.completed .column-dot {
  background: var(--moss);
}
.clue-card {
  border: 1px solid var(--line);
  background: var(--ink-820);
  border-radius: 10px;
  padding: 17px;
  margin-top: 12px;
}
.clue-card-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 10px;
  color: var(--text-faint);
}
.clue-card-top > span {
  display: flex;
  align-items: center;
  gap: 5px;
}
.clue-card p {
  color: var(--text);
  font-size: 13px;
  line-height: 1.95;
  margin: 13px 0 19px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.clue-complete {
  display: flex;
  gap: 7px;
  align-items: center;
  background: none;
  border: 0;
  font-size: 10px;
  color: var(--text-faint);
  padding: 0;
}
.clue-complete:hover {
  color: var(--moss);
}
.completed .clue-card-top > span {
  color: var(--moss);
}
.completed .clue-card p {
  color: var(--text-dim);
}

.empty-column {
  padding: 58px 20px;
  text-align: center;
  color: var(--text-faint);
}
.empty-column p {
  font-size: 12px;
  line-height: 1.8;
}

@media (max-width: 1200px) {
  .clue-summary {
    gap: 14px;
  }
  .summary-progress,
  .clue-summary small {
    display: none;
  }
}
@media (max-width: 650px) {
  .clue-board {
    grid-template-columns: 1fr;
    gap: 12px;
  }
  .clue-column {
    min-height: 200px;
  }
  .toolbar-buttons {
    margin-left: auto;
  }
  .clue-summary b {
    font-size: 19px;
  }
  .empty-column {
    padding: 30px 12px;
  }
}
</style>
