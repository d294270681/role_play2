<script setup>
import { computed, ref } from "vue";
import Icon from "../Icon.vue";
import ClockDial from "../ClockDial.vue";
import { applyEdit, game } from "../../store.js";
const clocks = computed(() => game.state?.clocks || []),
  showAdd = ref(false),
  editing = ref(false);
const draft = ref({ name: "", max: 6, consequence: "" });
async function add() {
  if (!draft.value.name.trim()) return;
  if (
    await applyEdit({
      op: "add_clock",
      name: draft.value.name.trim(),
      max: Number(draft.value.max) || 6,
      consequence: draft.value.consequence.trim(),
    })
  ) {
    draft.value = { name: "", max: 6, consequence: "" };
    showAdd.value = false;
  }
}
const setValue = (clock, value) =>
  applyEdit({ op: "set_clock", name: clock.name, value: Number(value) || 0 });
const advance = (clock, delta) =>
  setValue(clock, (Number(clock.value) || 0) + delta);
</script>
<template>
  <div v-if="!game.loaded" class="empty-hint">
    载入存档后，可以追踪调查进展、期限或逐步逼近的威胁。
  </div>
  <template v-else>
    <div class="panel-toolbar">
      <span class="hint">每格是一份进展。到达上限时，请关注对应的后果。</span>
      <div class="toolbar-buttons">
        <button
          class="secondary-button"
          :aria-pressed="editing"
          @click="editing = !editing"
        >
          {{ editing ? "完成管理" : "管理进度钟" }}</button
        ><button
          class="primary-button"
          :disabled="game.busy"
          @click="showAdd = true"
        >
          <Icon name="plus" :size="15" />新建进度钟
        </button>
      </div>
    </div>
    <div class="clocks-grid">
      <article
        v-for="clock in clocks"
        :key="clock.name"
        class="card clock-card"
        :class="{ complete: clock.value >= clock.max }"
      >
        <div class="clock-top">
          <span
            class="tag"
            :class="clock.value >= clock.max ? 'complete-tag' : 'subtle'"
            >{{ clock.value >= clock.max ? "已达上限" : "进行中" }}</span
          ><button
            v-if="editing"
            class="icon-button remove-clock"
            :disabled="game.busy"
            :aria-label="'删除进度钟' + clock.name"
            @click="applyEdit({ op: 'remove_clock', name: clock.name })"
          >
            <Icon name="close" :size="16" />
          </button>
        </div>
        <div class="clock-visual">
          <ClockDial
            :value="Number(clock.value) || 0"
            :max="Number(clock.max) || 6"
            :label="clock.name"
            :size="116"
          />
          <div>
            <h3>{{ clock.name }}</h3>
            <p>
              {{
                clock.value >= clock.max
                  ? "时限已经到来"
                  : "还剩 " + (clock.max - clock.value) + " 格"
              }}
            </p>
          </div>
        </div>
        <div class="clock-consequence">
          <span>满格后果</span>
          <p>{{ clock.consequence || "未记录具体后果。" }}</p>
        </div>
        <div class="clock-controls">
          <button
            class="secondary-button"
            :disabled="game.busy || clock.value <= 0"
            :aria-label="clock.name + '减1'"
            @click="advance(clock, -1)"
          >
            −1</button
          ><span>{{ clock.value }} / {{ clock.max }}</span
          ><button
            class="secondary-button"
            :disabled="game.busy || clock.value >= clock.max"
            :aria-label="clock.name + '加1'"
            @click="advance(clock, 1)"
          >
            +1
          </button>
        </div>
        <div v-if="editing && clock.max <= 24" class="clock-cells">
          <button
            v-for="i in Number(clock.max)"
            :key="i"
            class="clock-cell"
            :class="{ on: i <= clock.value }"
            :disabled="game.busy"
            :aria-label="clock.name + '设置为' + (i <= clock.value ? i - 1 : i)"
            @click="setValue(clock, i <= clock.value ? i - 1 : i)"
          ></button>
        </div>
        <n-input-number
          v-else-if="editing"
          :value="Number(clock.value) || 0"
          :min="0"
          :max="Number(clock.max)"
          :disabled="game.busy"
          size="small"
          @change="(value) => setValue(clock, value)"
        />
      </article>
      <div v-if="!clocks.length" class="empty-hint">
        <Icon name="target" :size="30" />
        <p>还没有进度钟。可以添加一个调查目标、期限或威胁。</p>
      </div>
    </div>
    <n-modal
      v-model:show="showAdd"
      preset="card"
      title="新建进度钟"
      style="max-width: 470px"
      :bordered="false"
      ><div class="clock-form">
        <label>进度钟名称</label
        ><n-input
          v-model:value="draft.name"
          placeholder="例如：码头帮警觉"
        /><label>格数</label
        ><n-input-number v-model:value="draft.max" :min="1" :max="12" /><label
          >到达上限的后果</label
        ><n-input
          v-model:value="draft.consequence"
          type="textarea"
          :autosize="{ minRows: 2, maxRows: 4 }"
          placeholder="进展完成，或者威胁会怎样发生？"
        />
      </div>
      <template #footer
        ><div class="modal-actions">
          <n-button @click="showAdd = false">取消</n-button
          ><n-button
            type="primary"
            :disabled="!draft.name.trim() || game.busy"
            @click="add"
            >建立进度钟</n-button
          >
        </div></template
      ></n-modal
    >
  </template>
</template>
<style scoped>
.toolbar-buttons {
  display: flex;
  gap: 8px;
}
.clocks-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
  align-items: start;
}
.clock-card {
  display: flex;
  flex-direction: column;
  gap: 19px;
}
.clock-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.clock-visual {
  display: flex;
  gap: 19px;
  align-items: center;
}
.clock-visual > svg {
  flex-shrink: 0;
}
.clock-visual h3 {
  font-size: 15px;
  margin: 0;
  line-height: 1.7;
}
.clock-visual p {
  color: var(--text-faint);
  font-size: 11px;
  margin: 6px 0 0;
}
.clock-consequence {
  padding: 13px;
  background: var(--ink-860);
  border: 1px solid var(--line-soft);
  border-radius: 8px;
}
.clock-consequence > span {
  font-size: 10px;
  color: var(--text-faint);
}
.clock-consequence p {
  font-size: 12px;
  line-height: 1.9;
  color: var(--text-dim);
  margin: 5px 0 0;
  min-height: 44px;
}
.clock-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
}
.clock-controls > span {
  font-size: 11px;
  color: var(--text-faint);
  min-width: 44px;
  text-align: center;
}
.clock-controls > button {
  padding: 7px 13px;
}
.complete {
  border-color: #dc7a6f55;
  background: #df8a8009;
}
.complete-tag {
  color: var(--blood);
  border-color: #df8a8050;
}
.complete .clock-consequence {
  border-color: #df8a8030;
}
.remove-clock {
  color: var(--blood);
}
.clocks-grid > .empty-hint {
  grid-column: 1/-1;
}
.clock-form {
  display: grid;
  gap: 9px;
}
.clock-form label {
  font-size: 12px;
  color: var(--text-dim);
}
.modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
@media (max-width: 1500px) {
  .clocks-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .clock-visual > svg {
    width: 99px;
    height: 99px;
  }
}
@media (max-width: 700px) {
  .clocks-grid {
    grid-template-columns: 1fr;
    gap: 12px;
  }
  .clock-visual > svg {
    width: 112px;
    height: 112px;
  }
}
</style>
