<script setup>
import { computed, ref } from "vue";
import Icon from "../Icon.vue";
import GaugeMeter from "../GaugeMeter.vue";
import { game, stageAction } from "../../store.js";
import { clamp, relationLabel } from "../../ui.js";
import { signed } from "../../util.js";
const relations = computed(() => game.state?.relations || []);
const party = computed(() =>
  Object.entries(game.state?.party || {}).filter(([name]) =>
    relations.value.some((relation) => relation.npc === name),
  ),
);
const query = ref("");
const people = computed(() =>
  [...new Set(relations.value.map((relation) => relation.npc))]
    .map((name) => ({
      name,
      card: game.characters.find((card) => card.name === name),
      relation: relations.value.find((relation) => relation.npc === name),
    }))
    .filter((person) =>
      (person.name + " " + (person.card?.concept || "")).includes(
        query.value.trim(),
      ),
    ),
);
</script>
<template>
  <div v-if="!game.loaded" class="empty-hint">
    旅途中认识的人物和关系会显示在这里。
  </div>
  <template v-else>
    <div class="panel-toolbar">
      <div class="search-field">
        <Icon name="search" :size="15" /><input
          v-model="query"
          aria-label="搜索人物"
          placeholder="搜索已认识的人物或身份…"
        />
      </div>
      <p class="hint">相识后解锁，关系会随对话与实际互动变化。</p>
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
          <p v-if="person.relation.note" class="person-note">
            {{ person.relation.note }}
          </p></template
        >

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
            : "还没有相识的人物。探索和对话后，新的人物关系会自动记录。"
        }}
      </div>
    </div>
    <section v-if="party.length" class="card party-section">
      <h3 class="section-label">已知人物状态</h3>
      <div class="party-grid">
        <article v-for="[name, member] in party" :key="name" class="party-card">
          <div class="party-title">
            <span class="person-avatar small">{{ name.slice(0, 1) }}</span>
            <div>
              <b>{{ name }}</b
              ><small
                >关系：{{ relationLabel(member.relation) }} ·
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
      <p class="hint">
        这里展示已认识人物的公开状态。关系与资料会随实际互动更新。
      </p>
    </section>
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
}
</style>
