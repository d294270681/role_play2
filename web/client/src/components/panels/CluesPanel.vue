<script setup>
import { computed, ref } from "vue";
import Icon from "../Icon.vue";
import { applyEdit, game } from "../../store.js";
const clues = computed(() => game.state?.clues || []),
  active = computed(() => clues.value.filter((clue) => !clue.done)),
  done = computed(() => clues.value.filter((clue) => clue.done));
const showAdd = ref(false),
  draft = ref(""),
  editing = ref(false);
const progress = computed(() =>
  clues.value.length
    ? Math.round((done.value.length / clues.value.length) * 100)
    : 0,
);
async function add() {
  if (!draft.value.trim()) return;
  if (await applyEdit({ op: "add_clue", text: draft.value.trim() })) {
    draft.value = "";
    showAdd.value = false;
  }
}
</script>
<template>
  <div v-if="!game.loaded" class="empty-hint">
    载入存档后，记录你发现的线索，并追踪它们的进展。
  </div>
  <template v-else>
    <div class="panel-toolbar">
      <div class="clue-summary">
        <span
          ><b>{{ active.length }}</b
          >待追踪</span
        ><span
          ><b>{{ done.length }}</b
          >已完成</span
        >
        <div class="summary-progress">
          <i :style="{ width: progress + '%' }"></i>
        </div>
        <small>{{ progress }}%</small>
      </div>
      <div class="toolbar-buttons">
        <button
          class="secondary-button"
          :aria-pressed="editing"
          @click="editing = !editing"
        >
          {{ editing ? "完成管理" : "管理线索" }}</button
        ><button
          class="primary-button"
          :disabled="game.busy"
          @click="showAdd = true"
        >
          <Icon name="plus" :size="15" />记录线索
        </button>
      </div>
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
          :key="clue.text"
          class="clue-card"
        >
          <div class="clue-card-top">
            <span>线索 {{ String(index + 1).padStart(2, "0") }}</span
            ><button
              v-if="editing"
              class="icon-button remove-clue"
              :disabled="game.busy"
              :aria-label="'删除线索' + clue.text"
              @click="applyEdit({ op: 'remove_clue', text: clue.text })"
            >
              <Icon name="close" :size="15" />
            </button>
          </div>
          <p>{{ clue.text }}</p>
          <button
            class="clue-complete"
            :disabled="game.busy"
            @click="applyEdit({ op: 'toggle_clue', text: clue.text })"
          >
            <span class="check-box"></span>标记完成
          </button>
        </article>
        <div v-if="!active.length" class="empty-column">
          <Icon name="search" :size="28" />
          <p>
            {{
              done.length
                ? "所有已记录线索都已完成。"
                : "新的发现，从记下一条线索开始。"
            }}
          </p>
        </div>
      </section>
      <section class="clue-column completed">
        <div class="column-heading">
          <span class="column-dot"></span>
          <h3>已完成</h3>
          <span>{{ done.length }}</span>
        </div>
        <article v-for="clue in done" :key="clue.text" class="clue-card">
          <div class="clue-card-top">
            <span><Icon name="check" :size="12" />已完成</span
            ><button
              v-if="editing"
              class="icon-button remove-clue"
              :disabled="game.busy"
              :aria-label="'删除线索' + clue.text"
              @click="applyEdit({ op: 'remove_clue', text: clue.text })"
            >
              <Icon name="close" :size="15" />
            </button>
          </div>
          <p>{{ clue.text }}</p>
          <button
            class="clue-complete"
            :disabled="game.busy"
            @click="applyEdit({ op: 'toggle_clue', text: clue.text })"
          >
            重新打开<Icon name="refresh" :size="12" />
          </button>
        </article>
        <div v-if="!done.length" class="empty-column">
          <Icon name="check" :size="28" />
          <p>完成的线索会归档在这里。</p>
        </div>
      </section>
    </div>
    <n-modal
      v-model:show="showAdd"
      preset="card"
      title="记录一条线索"
      style="max-width: 500px"
      :bordered="false"
      ><n-input
        v-model:value="draft"
        type="textarea"
        :autosize="{ minRows: 4, maxRows: 8 }"
        placeholder="发现了什么？下一步可以追踪什么？"
        @keyup.ctrl.enter="add"
      /><template #footer
        ><div class="modal-actions">
          <n-button @click="showAdd = false">取消</n-button
          ><n-button
            type="primary"
            :disabled="game.busy || !draft.trim()"
            @click="add"
            >加入线索板</n-button
          >
        </div></template
      ></n-modal
    >
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
.toolbar-buttons {
  display: flex;
  gap: 8px;
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
.check-box {
  width: 12px;
  height: 12px;
  border: 1px solid var(--line-bright);
  border-radius: 3px;
}
.completed .clue-card-top > span {
  color: var(--moss);
}
.completed .clue-card p {
  color: var(--text-dim);
}
.remove-clue {
  color: var(--blood);
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
.modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
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
