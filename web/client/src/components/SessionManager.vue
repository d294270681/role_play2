<script setup>
import { computed, ref } from "vue";
import Icon from "./Icon.vue";
import {
  game,
  newGame,
  openSlot,
  refreshSlots,
  selectModule,
} from "../store.js";
const creating = ref(false),
  newSlot = ref(1),
  characterName = ref("");
const freeSlot = computed(
  () => game.slots.find((slot) => !slot.exists)?.slot || 1,
);
const title = computed(
  () =>
    game.modules.find((module) => module.dir === game.module)?.title ||
    game.module,
);
async function pickModule(dir) {
  if (game.busy || game.loading || dir === game.module) return;
  creating.value = false;
  await selectModule(dir);
}
function startCreate(slot = freeSlot.value) {
  if (game.busy || game.loading) return;
  newSlot.value = slot;
  characterName.value = "";
  creating.value = true;
}
async function pickSlot(slot) {
  if (game.busy || game.loading) return;
  if (!slot.exists) return startCreate(slot.slot);
  if (game.loaded && game.slot === slot.slot) {
    game.sessionsOpen = false;
    return;
  }
  if (await openSlot(slot.slot)) game.sessionsOpen = false;
}
async function confirmCreate() {
  const slot = Number(newSlot.value) || 1;
  if (
    game.slots.some((info) => info.slot === slot && info.exists) &&
    !window.confirm(
      "存档 " + slot + " 已有冒险记录。新建会覆盖该存档，确定继续？",
    )
  )
    return;
  if (await newGame({ character: characterName.value, slot })) {
    creating.value = false;
    game.sessionsOpen = false;
  }
}
</script>
<template>
  <n-modal
    v-model:show="game.sessionsOpen"
    preset="card"
    title="冒险与存档"
    style="max-width: 760px"
    :bordered="false"
  >
    <p class="dialog-intro">
      选择冒险本，继续一段旅程，或者为新的角色建立存档。
    </p>
    <div class="module-options">
      <button
        v-for="module in game.modules"
        :key="module.dir"
        class="module-choice"
        :class="{ selected: module.dir === game.module }"
        :disabled="game.busy || game.loading"
        @click="pickModule(module.dir)"
      >
        <Icon name="book" :size="22" /><span
          ><b>{{ module.title }}</b
          ><small
            >{{ module.rating || "文字冒险" }} ·
            {{ module.tone || "自由探索" }}</small
          ></span
        ><Icon v-if="module.dir === game.module" name="check" :size="18" />
      </button>
      <div v-if="!game.modules.length" class="empty-hint">
        还没有冒险本，请先在 modules 目录中添加内容。
      </div>
    </div>
    <div class="session-heading">
      <h3>{{ title || "存档" }}</h3>
      <button
        class="text-button"
        :disabled="game.busy || game.loading || !game.module"
        @click="refreshSlots()"
      >
        <Icon name="refresh" :size="14" />刷新
      </button>
    </div>
    <div v-if="!creating" class="save-grid">
      <div
        v-for="slot in game.slots"
        :key="slot.slot"
        class="save-card"
        :class="{
          active: game.slot === slot.slot && game.loaded,
          empty: !slot.exists,
        }"
      >
        <button
          class="save-main"
          :disabled="game.busy || game.loading"
          @click="pickSlot(slot)"
        >
          <span class="save-number"
            >存档 {{ String(slot.slot).padStart(2, "0")
            }}<span
              v-if="game.slot === slot.slot && game.loaded"
              class="tag subtle"
              >当前</span
            ></span
          >
          <Icon :name="slot.exists ? 'save' : 'plus'" :size="30" />
          <b>{{ slot.exists ? slot.character || slot.title : "开始新冒险" }}</b>
          <span class="save-place">{{
            slot.exists
              ? ["第 " + slot.day + " 天", slot.period, slot.location]
                  .filter(Boolean)
                  .join(" · ")
              : "一个尚未写下的故事"
          }}</span>
          <small>{{ slot.exists ? slot.updated : "点击创建存档" }}</small>
        </button>
        <button
          v-if="slot.exists"
          class="save-replace"
          :disabled="game.busy || game.loading"
          @click="startCreate(slot.slot)"
        >
          在此存档重新开始
        </button>
      </div>
      <div v-if="!game.slots.length" class="empty-hint">
        选择冒险本后，可查看存档。
      </div>
    </div>
    <div v-else class="create-form">
      <h3>创建角色与存档</h3>
      <label for="new-character-name">角色名</label>
      <n-input
        v-model:value="characterName"
        :input-props="{ id: 'new-character-name' }"
        placeholder="留空使用冒险本默认角色"
        :disabled="game.busy"
      />
      <label>存档位置</label
      ><n-select
        v-model:value="newSlot"
        :disabled="game.busy"
        :options="[1, 2, 3].map((value) => ({ label: '存档 ' + value, value }))"
      />
      <p class="hint">使用所选冒险本的初始设定。已有存档将要求确认后才覆盖。</p>
      <div class="form-actions">
        <n-button :disabled="game.busy" @click="creating = false">返回</n-button
        ><n-button type="primary" :loading="game.busy" @click="confirmCreate"
          >开始冒险</n-button
        >
      </div>
    </div>
    <template #footer
      ><div class="session-footer">
        <span>每次行动完成后，游戏自动保存。</span
        ><n-button @click="game.sessionsOpen = false">关闭</n-button>
      </div></template
    >
  </n-modal>
</template>
<style scoped>
.dialog-intro {
  color: var(--text-dim);
  margin: 0 0 18px;
  font-size: 13px;
}
.module-options {
  display: grid;
  gap: 8px;
}
.module-choice {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--ink-860);
  text-align: left;
  color: var(--text);
}
.module-choice > span {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 5px;
}
.module-choice small {
  font-size: 12px;
  color: var(--text-dim);
}
.module-choice.selected {
  border-color: var(--brass-dim);
  background: var(--brass-wash);
}
.module-choice > svg {
  color: var(--brass);
}
.session-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 22px 0 12px;
}
.session-heading h3 {
  margin: 0;
  font-size: 15px;
}
.save-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.save-card {
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--ink-860);
  overflow: hidden;
}
.save-card.active {
  border-color: var(--brass-dim);
}
.save-card.empty {
  border-style: dashed;
}
.save-main {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  padding: 16px;
  min-height: 208px;
  text-align: left;
  border: 0;
  background: none;
  color: var(--text);
}
.save-number {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--text-faint);
}
.save-main > svg {
  color: var(--brass);
  margin: 8px 0;
}
.save-place {
  font-size: 12px;
  color: var(--text-dim);
}
.save-main small {
  font-size: 11px;
  color: var(--text-faint);
}
.save-replace {
  padding: 8px;
  width: 100%;
  border: 0;
  border-top: 1px solid var(--line);
  background: transparent;
  color: var(--text-faint);
  font-size: 11px;
}
.create-form {
  display: grid;
  gap: 10px;
  background: var(--ink-860);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 22px;
}
.create-form h3 {
  margin: 0 0 4px;
}
.create-form label {
  font-size: 12px;
  color: var(--text-dim);
}
.form-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.session-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  color: var(--text-faint);
  font-size: 12px;
}
@media (max-width: 600px) {
  .save-grid {
    grid-template-columns: 1fr;
  }
  .save-main {
    min-height: 130px;
  }
  .module-choice small {
    line-height: 1.7;
  }
  .session-footer span {
    font-size: 11px;
  }
}
</style>
