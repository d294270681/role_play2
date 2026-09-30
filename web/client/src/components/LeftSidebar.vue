<script setup>
import { computed, ref } from "vue";

import { game, newGame, notify, openSlot, refreshSlots, selectModule } from "../store.js";

const creating = ref(false);
const newSlot = ref(1);
const characterName = ref("");

/** 当前本里第一个空槽 / 当前槽。 */
const freeSlot = computed(() => game.slots.find((s) => !s.exists)?.slot || 1);

async function pickModule(dir) {
  if (dir === game.module) return;
  if (game.busy) {
    // 回合还在流式接收：此时切本会先 clearStream()，随后旧本的 state 事件
    // 又会把旧存档盖到新本面板上。等回合结束（或先中止）再切。
    notify("回合进行中，等这一回合结束再切本", "warn");
    return;
  }
  selectModule(dir).catch((e) => notify(e?.message ?? String(e), "error"));
}

function pickSlot(slot) {
  if (slot === game.slot && game.loaded) return;
  if (game.busy) {
    notify("回合进行中，稍后再切换存档", "warn");
    return;
  }
  const info = game.slots.find((s) => s.slot === slot);
  if (info && !info.exists) {
    // 空槽直接开新档，省得先点一次「＋」
    startCreate(slot);
    return;
  }
  openSlot(slot).catch((e) => notify(e?.message ?? String(e), "error"));
}

function startCreate(slot) {
  newSlot.value = slot || freeSlot.value;
  characterName.value = "";
  creating.value = true;
}

async function confirmCreate() {
  const slot = Number(newSlot.value) || 1;
  const occupied = game.slots.find((s) => s.slot === slot && s.exists);
  if (occupied && !window.confirm(`槽位 ${slot} 已有存档（${occupied.updated || ""}），开新档会覆盖它。继续？`)) {
    return;
  }
  creating.value = false;
  await newGame({ character: characterName.value, slot });
}

function slotSummary(s) {
  if (!s.exists) return "空档位";
  return [s.day ? `第 ${s.day} 天` : null, s.period, s.location].filter(Boolean).join(" · ");
}
</script>

<template>
  <aside class="sidebar" :class="{ collapsed: game.leftCollapsed }">
    <template v-if="game.leftCollapsed">
      <button class="rail-btn" title="展开左栏" @click="game.leftCollapsed = false">›</button>
    </template>

    <template v-else>
      <section class="block">
        <h3 class="section-label">RPG 本</h3>
        <ul class="module-list">
          <li v-for="m in game.modules" :key="m.dir">
            <button
              class="module-item"
              :class="{ active: m.dir === game.module }"
              :title="m.tone || m.dir"
              @click="pickModule(m.dir)"
            >
              <span class="m-title">{{ m.title }}</span>
              <span class="m-meta">{{ m.rating || m.engine }}</span>
            </button>
          </li>
          <li v-if="!game.modules.length" class="empty-hint">后端未返回任何本。</li>
        </ul>
      </section>

      <section class="block">
        <h3 class="section-label">存档槽</h3>
        <ul class="slot-list">
          <li
            v-for="s in game.slots"
            :key="s.slot"
            class="slot-item"
            :class="{ active: s.slot === game.slot, empty: !s.exists }"
            @click="pickSlot(s.slot)"
          >
            <div class="slot-head">
              <span class="slot-no">{{ s.slot }}</span>
              <span class="slot-title">{{ s.exists ? s.character || s.title : "空档位" }}</span>
              <button class="slot-del" title="在此槽开新档" @click.stop="startCreate(s.slot)">＋</button>
            </div>
            <div class="slot-meta">{{ slotSummary(s) }}</div>
            <div v-if="s.exists" class="slot-updated">{{ s.updated }}</div>
          </li>
          <li v-if="!game.slots.length" class="empty-hint">请先选择一本。</li>
        </ul>
      </section>

      <section class="block foot">
        <button class="primary-btn" :disabled="!game.module" @click="startCreate(freeSlot)">＋ 新建存档</button>
        <button
          class="ghost-btn"
          :disabled="!game.module"
          @click="refreshSlots().catch((e) => notify(e?.message ?? String(e), 'error'))"
        >
          刷新槽位
        </button>
      </section>
    </template>

    <n-modal v-model:show="creating" preset="card" title="开新档" style="max-width: 420px">
      <div class="form">
        <label class="lbl">槽位</label>
        <n-select v-model:value="newSlot" :options="[1, 2, 3].map((n) => ({ label: `槽位 ${n}`, value: n }))" />
        <label class="lbl">角色名（留空用本册默认）</label>
        <n-input v-model:value="characterName" placeholder="例如：阿澄" clearable />
        <div class="form-hint">开新档会按本册 module.md 的开局设定重置该槽位。</div>
      </div>
      <template #footer>
        <n-space justify="end">
          <n-button @click="creating = false">取消</n-button>
          <n-button type="primary" @click="confirmCreate">开档</n-button>
        </n-space>
      </template>
    </n-modal>
  </aside>
</template>

<style scoped>
.sidebar {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 14px 12px;
  overflow-y: auto;
}
.sidebar.collapsed { padding: 10px 6px; align-items: center; }

.rail-btn {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: #171c24;
  color: var(--text-dim);
  cursor: pointer;
}

.block { flex-shrink: 0; }
.block.foot { margin-top: auto; display: flex; flex-direction: column; gap: 8px; }

.module-list, .slot-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }

.module-item {
  width: 100%;
  text-align: left;
  padding: 8px 10px;
  border-radius: 9px;
  border: 1px solid var(--line-soft);
  background: var(--ink-820);
  color: var(--text-dim);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
  transition: all 0.15s;
}
.module-item:hover { border-color: var(--brass-dim); color: var(--text); }
.module-item.active {
  border-color: var(--brass);
  background: linear-gradient(90deg, rgba(212, 169, 74, 0.14), rgba(212, 169, 74, 0.03));
  color: var(--text);
}
.m-title { font-size: 13px; font-weight: 600; }
.m-meta { font-size: 11px; color: var(--text-faint); }

.slot-item {
  padding: 8px 10px;
  border-radius: 9px;
  border: 1px solid var(--line-soft);
  background: var(--ink-820);
  cursor: pointer;
  transition: all 0.15s;
}
.slot-item:hover { border-color: var(--brass-dim); }
.slot-item.active { border-color: var(--brass); background: rgba(212, 169, 74, 0.08); }
.slot-item.empty { opacity: 0.72; border-style: dashed; }
.slot-head { display: flex; align-items: center; gap: 7px; }
.slot-no {
  width: 17px; height: 17px; line-height: 17px; text-align: center;
  border-radius: 5px; background: #232b36; color: var(--text-dim);
  font-size: 11px; font-weight: 700;
}
.slot-title { font-size: 12.5px; font-weight: 600; color: var(--text); flex: 1; }
.slot-del {
  border: none; background: transparent; color: var(--text-faint);
  cursor: pointer; font-size: 14px; line-height: 1; padding: 0 2px;
}
.slot-del:hover { color: var(--brass); }
.slot-meta { font-size: 11.5px; color: var(--text-dim); margin-top: 3px; }
.slot-updated { font-size: 10.5px; color: var(--text-faint); margin-top: 1px; }

.primary-btn {
  padding: 9px;
  border-radius: 9px;
  border: 1px solid var(--brass-dim);
  background: linear-gradient(180deg, #d4a94a, #b8913a);
  color: #1a1408;
  font-weight: 700;
  cursor: pointer;
}
.primary-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.ghost-btn {
  padding: 7px;
  border-radius: 9px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
}
.ghost-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.ghost-btn:hover:not(:disabled) { color: var(--text); border-color: var(--brass-dim); }

.form { display: flex; flex-direction: column; gap: 6px; }
.lbl { font-size: 12px; color: var(--text-dim); margin-top: 6px; }
.form-hint { font-size: 11.5px; color: var(--text-faint); margin-top: 8px; }
</style>
