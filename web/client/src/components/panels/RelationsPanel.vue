<script setup>
import { computed, ref } from "vue";

import { applyEdit, game } from "../../store.js";
import { signed } from "../../util.js";

const relations = computed(() => game.state?.relations || []);
const party = computed(() => Object.entries(game.state?.party || {}));

const newNpc = ref("");
const showAdd = ref(false);

async function add() {
  const npc = newNpc.value.trim();
  if (!npc) return;
  const ok = await applyEdit({ op: "set_relation", npc, value: 0 });
  if (ok) {
    newNpc.value = "";
    showAdd.value = false;
  }
}

const setValue = (npc, value) => applyEdit({ op: "set_relation", npc, value: Number(value) || 0 });
const setNote = (npc, note) => applyEdit({ op: "set_relation", npc, note: String(note ?? "") });

/** 关系档位：−5 敌对 … 0 陌生 … +5 亲密。 */
function relationWord(v) {
  const n = Number(v) || 0;
  if (n <= -4) return "死敌";
  if (n === -3) return "仇怨";
  if (n === -2) return "厌恶";
  if (n === -1) return "冷淡";
  if (n === 0) return "陌生";
  if (n === 1) return "点头";
  if (n === 2) return "熟人";
  if (n === 3) return "交情";
  if (n === 4) return "信任";
  return "生死之交";
}

function barColor(v) {
  const n = Math.max(-5, Math.min(5, Number(v) || 0));
  if (n > 0) return `color-mix(in srgb, var(--moss) ${35 + n * 13}%, #2c3441)`;
  if (n < 0) return `color-mix(in srgb, var(--blood) ${35 + -n * 13}%, #2c3441)`;
  return "#2c3441";
}
</script>

<template>
  <div v-if="!game.loaded" class="empty-hint">还没有载入存档。</div>

  <template v-else>
    <section class="card">
      <div class="head-row">
        <h4 class="section-label" style="margin: 0; flex: 1">关系（{{ relations.length }}）</h4>
        <n-button size="tiny" type="primary" ghost @click="showAdd = !showAdd">
          {{ showAdd ? "取消" : "＋ 新增" }}
        </n-button>
      </div>

      <div v-if="showAdd" class="add-box">
        <n-input v-model:value="newNpc" size="small" placeholder="NPC 名" @keyup.enter="add" />
        <n-button size="small" type="primary" block :disabled="!newNpc.trim()" @click="add">建立关系（初始 0）</n-button>
      </div>

      <ul class="rel-list">
        <li v-for="r in relations" :key="r.npc" class="rel">
          <div class="rel-head">
            <span class="r-npc">{{ r.npc }}</span>
            <span class="r-val" :style="{ color: barColor(r.value) }">{{ signed(r.value) }}</span>
            <span class="r-word">{{ relationWord(r.value) }}</span>
          </div>
          <div class="rel-bar">
            <div class="rel-track">
              <div class="rel-center" />
              <div
                class="rel-fill"
                :style="{
                  background: barColor(r.value),
                  left: r.value >= 0 ? '50%' : `${50 + (Number(r.value) / 5) * 50}%`,
                  width: `${Math.abs(Number(r.value) || 0) * 10}%`,
                }"
              />
            </div>
            <div class="rel-step">
              <button class="mini" @click="setValue(r.npc, (Number(r.value) || 0) - 1)">−</button>
              <button class="mini" @click="setValue(r.npc, (Number(r.value) || 0) + 1)">＋</button>
            </div>
          </div>
          <n-input
            :value="r.note"
            size="tiny"
            placeholder="备注"
            @blur="(e) => { const v = e?.target?.value ?? ''; if (v !== (r.note || '')) setNote(r.npc, v); }"
          />
        </li>
        <li v-if="!relations.length" class="empty-hint">还没有记录任何关系。</li>
      </ul>
    </section>

    <section v-if="party.length" class="card">
      <h4 class="section-label">同行者</h4>
      <ul class="party-list">
        <li v-for="[name, p] in party" :key="name" class="party">
          <div class="p-head">
            <span class="p-name">{{ name }}</span>
            <span class="p-rel">{{ relationWord(p.relation) }}（{{ signed(p.relation) }}）</span>
          </div>
          <div v-if="p.gauges && Object.keys(p.gauges).length" class="p-gauges">
            <span v-for="[gn, g] in Object.entries(p.gauges)" :key="gn" class="p-gauge">
              {{ gn }} {{ g.value }}/{{ g.max }}
            </span>
          </div>
          <div v-if="p.notes" class="p-notes">{{ p.notes }}</div>
        </li>
      </ul>
      <p class="hint">同行者关系由 GM 的 state_patch 结算，这里是只读视图；「关系」里可手动覆盖。</p>
    </section>
  </template>
</template>

<style scoped>
.card { display: flex; flex-direction: column; gap: 9px; }
.head-row { display: flex; align-items: center; gap: 8px; }
.add-box { display: flex; flex-direction: column; gap: 6px; padding: 9px; border: 1px dashed var(--line); border-radius: 9px; }

.rel-list, .party-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.rel { padding: 8px; border-radius: 9px; background: #161c24; border: 1px solid var(--line-soft); display: flex; flex-direction: column; gap: 6px; }
.rel-head { display: flex; align-items: baseline; gap: 7px; }
.r-npc { font-size: 12.5px; color: var(--text); flex: 1; }
.r-val { font-size: 15px; font-family: var(--serif); font-variant-numeric: tabular-nums; }
.r-word { font-size: 10.5px; color: var(--text-faint); }

.rel-bar { display: flex; align-items: center; gap: 8px; }
.rel-track { position: relative; flex: 1; height: 7px; border-radius: 4px; background: #10141a; border: 1px solid var(--line-soft); overflow: hidden; }
.rel-center { position: absolute; left: 50%; top: 0; bottom: 0; width: 1px; background: var(--line); }
.rel-fill { position: absolute; top: 0; bottom: 0; transition: all 0.3s cubic-bezier(0.22, 0.61, 0.36, 1); }
.rel-step { display: flex; gap: 3px; }

.party { padding: 7px 8px; border-radius: 9px; background: #161c24; border: 1px solid var(--line-soft); }
.p-head { display: flex; align-items: baseline; gap: 8px; }
.p-name { font-size: 12.5px; color: var(--text); }
.p-rel { font-size: 10.5px; color: var(--text-faint); }
.p-gauges { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.p-gauge { font-size: 10.5px; color: var(--azure); border: 1px solid rgba(95, 149, 216, 0.3); border-radius: 9px; padding: 0 6px; }
.p-notes { font-size: 10.5px; color: var(--text-faint); line-height: 1.65; margin-top: 5px; }

.mini {
  width: 22px;
  height: 20px;
  border-radius: 5px;
  border: 1px solid var(--line);
  background: #171c24;
  color: var(--text-faint);
  font-size: 11px;
  cursor: pointer;
  line-height: 1;
}
.mini:hover { color: var(--brass); border-color: var(--brass-dim); }
.hint { font-size: 10.5px; color: var(--text-faint); margin: 0; line-height: 1.7; }
</style>
