<script setup>
import { computed, ref } from "vue";
import Icon from "../Icon.vue";
import GaugeMeter from "../GaugeMeter.vue";
import { applyEdit, game, stageAction } from "../../store.js";
import { clamp, relationLabel } from "../../ui.js";
import { signed } from "../../util.js";
const relations = computed(() => game.state?.relations || []),
  party = computed(() => Object.entries(game.state?.party || {}));
const query = ref(""),
  showAdd = ref(false),
  newNpc = ref(""),
  editing = ref(false);
const noteDrafts = ref(new Map());
const people = computed(() => {
  const names = new Set([
    ...game.characters
      .filter((card) => card.name !== game.state?.character?.name)
      .map((card) => card.name),
    ...relations.value.map((relation) => relation.npc),
  ]);
  return [...names]
    .map((name) => ({
      name,
      card: game.characters.find((card) => card.name === name),
      relation: relations.value.find((relation) => relation.npc === name),
    }))
    .filter((person) =>
      (person.name + " " + (person.card?.concept || "")).includes(
        query.value.trim(),
      ),
    );
});
async function add() {
  if (!newNpc.value.trim()) return;
  if (
    await applyEdit({ op: "set_relation", npc: newNpc.value.trim(), value: 0 })
  ) {
    newNpc.value = "";
    showAdd.value = false;
  }
}
const setValue = (npc, value) =>
  applyEdit({ op: "set_relation", npc, value: Number(value) || 0 });
async function setNote(person) {
  const value = noteDrafts.value.get(person.name);
  if (value === undefined || value === (person.relation?.note || "")) return;
  if (await applyEdit({ op: "set_relation", npc: person.name, note: value })) {
    if (noteDrafts.value.get(person.name) === value)
      noteDrafts.value.delete(person.name);
  }
}
</script>
<template>
  <div v-if="!game.loaded" class="empty-hint">
    旅途中认识的人物、关系和同行者会显示在这里。
  </div>
  <template v-else>
    <div class="panel-toolbar">
      <div class="search-field">
        <Icon name="search" :size="15" /><input
          v-model="query"
          aria-label="搜索人物"
          placeholder="搜索人物或身份…"
        />
      </div>
      <div class="toolbar-buttons">
        <button
          class="secondary-button"
          :aria-pressed="editing"
          @click="editing = !editing"
        >
          {{ editing ? "完成管理" : "管理关系" }}</button
        ><button
          class="primary-button"
          :disabled="game.busy"
          @click="showAdd = true"
        >
          <Icon name="plus" :size="15" />建立关系
        </button>
      </div>
    </div>
    <div class="people-grid">
      <article
        v-for="person in people"
        :key="person.name"
        class="card person-card"
      >
        <div class="person-heading">
          <span class="person-avatar">{{ person.name.slice(0, 1) }}</span>
          <div>
            <h3>{{ person.name }}</h3>
            <p>{{ person.card?.concept || "人物记录" }}</p>
          </div>
          <span
            v-if="person.relation"
            class="relation-value"
            :class="{
              friendly: person.relation.value > 0,
              hostile: person.relation.value < 0,
            }"
            >{{ signed(person.relation.value) }}</span
          >
        </div>
        <p v-if="person.card?.meta?.外貌" class="appearance">
          {{ person.card.meta.外貌 }}
        </p>
        <template v-if="person.relation"
          ><div class="relation-caption">
            <span>当前关系</span
            ><b>{{ relationLabel(person.relation.value) }}</b>
          </div>
          <div
            class="relation-track"
            :aria-label="'关系值' + person.relation.value"
          >
            <i class="relation-center"></i
            ><span
              :style="{
                left:
                  person.relation.value >= 0
                    ? '50%'
                    : 50 + clamp(person.relation.value, -5, 5) * 10 + '%',
                width: Math.abs(clamp(person.relation.value, -5, 5)) * 10 + '%',
              }"
              :class="{ hostile: person.relation.value < 0 }"
            ></span>
          </div>
          <div class="relation-labels">
            <span>死敌</span><span>中立</span><span>生死之交</span>
          </div>
          <p v-if="!editing && person.relation.note" class="person-note">
            {{ person.relation.note }}
          </p>
          <div v-if="editing" class="relation-controls">
            <button
              class="secondary-button"
              :disabled="game.busy || person.relation.value <= -5"
              :aria-label="person.name + '关系减1'"
              @click="setValue(person.name, person.relation.value - 1)"
            >
              −</button
            ><n-input
              :value="noteDrafts.get(person.name) ?? person.relation.note ?? ''"
              size="small"
              :disabled="game.busy"
              placeholder="关系备注"
              @update:value="(value) => noteDrafts.set(person.name, value)"
              @blur="setNote(person)"
            /><button
              class="secondary-button"
              :disabled="game.busy || person.relation.value >= 5"
              :aria-label="person.name + '关系加1'"
              @click="setValue(person.name, person.relation.value + 1)"
            >
              ＋
            </button>
          </div></template
        >
        <div v-else class="unknown-relation">
          <span>尚未建立关系记录</span
          ><button
            class="text-button"
            :disabled="game.busy"
            @click="setValue(person.name, 0)"
          >
            建立记录
          </button>
        </div>
        <button
          class="text-button conversation"
          :disabled="game.busy"
          @click="stageAction('向' + person.name + '询问近况')"
        >
          写下与{{ person.name }}的行动<Icon name="arrow" :size="14" />
        </button>
      </article>
      <div v-if="!people.length" class="empty-hint">
        {{
          query
            ? "没有找到匹配的人物。"
            : "还没有人物资料，可以建立一条关系记录。"
        }}
      </div>
    </div>
    <section v-if="party.length" class="card party-section">
      <h3 class="section-label">同行者状态</h3>
      <div class="party-grid">
        <article v-for="[name, member] in party" :key="name" class="party-card">
          <div class="party-title">
            <span class="person-avatar small">{{ name.slice(0, 1) }}</span>
            <div>
              <b>{{ name }}</b
              ><small
                >同行关系：{{ relationLabel(member.relation) }} ·
                {{ signed(member.relation) }}</small
              >
            </div>
          </div>
          <div class="party-gauges">
            <GaugeMeter
              v-for="[gaugeName, gauge] in Object.entries(member.gauges || {})"
              :key="gaugeName"
              :name="gaugeName"
              :gauge="gauge"
              compact
            />
          </div>
          <p v-if="member.notes">{{ member.notes }}</p>
          <div v-if="member.statuses?.length" class="party-statuses">
            <span v-for="status in member.statuses" :key="status" class="tag">{{
              status
            }}</span>
          </div>
        </article>
      </div>
      <p class="hint">同行者的状态与关系随冒险更新。这里展示你已知的资料。</p>
    </section>
    <n-modal
      v-model:show="showAdd"
      preset="card"
      title="建立人物关系"
      style="max-width: 420px"
      :bordered="false"
      ><n-input
        v-model:value="newNpc"
        placeholder="人物名称"
        @keyup.enter="add"
      />
      <p class="hint">初始关系为 0。可以随后调整数值与备注。</p>
      <template #footer
        ><div class="modal-actions">
          <n-button @click="showAdd = false">取消</n-button
          ><n-button
            type="primary"
            :disabled="game.busy || !newNpc.trim()"
            @click="add"
            >建立关系</n-button
          >
        </div></template
      ></n-modal
    >
  </template>
</template>
<style scoped>
.search-field {
  display: flex;
  gap: 9px;
  align-items: center;
  width: 280px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--ink-860);
  padding: 9px 12px;
  color: var(--text-faint);
}
.search-field input {
  width: 100%;
  min-width: 0;
  background: none;
  border: 0;
  outline: none;
  color: var(--text);
  font-size: 12px;
}
.search-field input::placeholder {
  color: var(--text-faint);
}
.search-field:focus-within {
  border-color: var(--brass-dim);
}
.toolbar-buttons {
  display: flex;
  gap: 8px;
}
.people-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  align-items: start;
}
.person-heading {
  display: flex;
  gap: 12px;
  align-items: center;
}
.person-avatar {
  width: 45px;
  height: 45px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  background: linear-gradient(135deg, #3a4136, #232b27);
  border: 1px solid #72816a38;
  color: #c5c8a9;
  font-family: var(--serif);
  font-size: 22px;
  border-radius: 11px;
}
.person-heading > div {
  flex: 1;
  min-width: 0;
}
.person-heading h3 {
  font-size: 15px;
  margin: 0;
  font-weight: 600;
}
.person-heading p {
  font-size: 11px;
  color: var(--text-faint);
  margin: 4px 0 0;
  line-height: 1.7;
}
.relation-value {
  font-size: 22px;
  font-weight: 600;
  color: var(--text-faint);
}
.friendly {
  color: var(--moss);
}
.hostile {
  color: var(--blood);
}
.appearance,
.person-note {
  font-size: 11px;
  line-height: 1.8;
  color: var(--text-dim);
}
.relation-caption {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-faint);
  margin-top: 23px;
  margin-bottom: 8px;
}
.relation-caption b {
  font-weight: 500;
  color: var(--text-dim);
}
.relation-track {
  height: 6px;
  border-radius: 4px;
  background: var(--ink-950);
  position: relative;
  overflow: hidden;
}
.relation-center {
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--line-bright);
  z-index: 1;
}
.relation-track > span {
  height: 100%;
  position: absolute;
  top: 0;
  background: var(--moss);
}
.relation-track > span.hostile {
  background: var(--blood);
}
.relation-labels {
  display: flex;
  justify-content: space-between;
  font-size: 9px;
  color: var(--text-faint);
  margin-top: 6px;
}
.relation-controls {
  display: flex;
  gap: 6px;
  margin-top: 12px;
}
.relation-controls > .n-input {
  flex: 1;
  min-width: 0;
}
.relation-controls button {
  padding: 4px 8px;
}
.unknown-relation {
  display: flex;
  gap: 8px;
  justify-content: space-between;
  align-items: center;
  font-size: 10px;
  color: var(--text-faint);
  margin-top: 20px;
}
.conversation {
  margin-top: 15px;
  padding-top: 12px;
  border-top: 1px solid var(--line-soft);
  width: 100%;
  justify-content: space-between;
  font-size: 10px;
}
.people-grid > .empty-hint {
  grid-column: 1/-1;
}
.party-section {
  margin-top: 22px;
}
.party-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
.party-card {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 16px;
}
.party-title {
  display: flex;
  gap: 10px;
  align-items: center;
}
.person-avatar.small {
  width: 35px;
  height: 35px;
  font-size: 17px;
}
.party-title b {
  font-size: 12px;
  font-weight: 500;
}
.party-title small {
  display: block;
  font-size: 10px;
  color: var(--text-faint);
}
.party-gauges {
  display: grid;
  gap: 12px;
  margin-top: 15px;
}
.party-card p {
  font-size: 11px;
  line-height: 1.8;
  color: var(--text-dim);
  margin-bottom: 0;
}
.party-statuses {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-top: 10px;
}
.modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
@media (max-width: 1400px) {
  .people-grid,
  .party-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 650px) {
  .people-grid,
  .party-grid {
    grid-template-columns: 1fr;
  }
  .search-field {
    width: 100%;
  }
  .toolbar-buttons {
    margin-left: auto;
  }
}
</style>
