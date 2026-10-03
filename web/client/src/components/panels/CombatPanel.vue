<script setup>
import { computed } from "vue";
import Icon from "../Icon.vue";
import GaugeMeter from "../GaugeMeter.vue";
import { game, navigate } from "../../store.js";
import { inventoryLoad, resourceAlerts, resourceRows } from "../../ui.js";
const character = computed(() => game.state?.character || {});
const attributes = computed(() => character.value.attributes || {}),
  skills = computed(() => character.value.skills || {});
const metrics = computed(() => [
  {
    label: "防御",
    value: character.value.defense ?? "—",
    detail: "角色当前防御值",
    icon: "shield",
  },
  {
    label: "格斗基础加值",
    value:
      (Number(attributes.value.体魄) || 0) + (Number(skills.value.格斗) || 0),
    detail: "体魄 + 格斗",
    icon: "swords",
  },
  {
    label: "射击基础加值",
    value:
      (Number(attributes.value.敏捷) || 0) + (Number(skills.value.射击) || 0),
    detail: "敏捷 + 射击",
    icon: "target",
  },
  {
    label: "先手基础加值",
    value:
      (Number(attributes.value.敏捷) || 0) + (Number(skills.value.察觉) || 0),
    detail: "敏捷 + 察觉",
    icon: "bolt",
  },
]);
const alerts = computed(() => resourceAlerts(game.state));
</script>
<template>
  <div v-if="!game.loaded" class="empty-hint">
    先载入角色，查看用于战斗的能力、资源与装备。
  </div>
  <template v-else>
    <div class="combat-notice">
      <Icon name="swords" :size="22" />
      <div>
        <b>战斗回合尚未接入</b>
        <p>
          这里汇总角色目前的战斗相关数据。交锋对象、回合顺序与战斗行动将在接入后展示。
        </p>
      </div>
      <span class="tag gold">战斗准备</span>
    </div>
    <div class="combat-metrics">
      <section v-for="metric in metrics" :key="metric.label" class="card">
        <Icon :name="metric.icon" :size="22" /><span>{{ metric.label }}</span
        ><b>{{ metric.value }}</b
        ><small>{{ metric.detail }}</small>
      </section>
    </div>
    <p class="hint">
      这里展示属性与技能的基础加值。实际判定还会计入状态和临时修正。
    </p>
    <div class="combat-layout">
      <section class="card preparation-stage">
        <div class="stage-heading">
          <h3>交锋准备</h3>
          <span class="tag subtle">尚未开始</span>
        </div>
        <div class="encounter-preview">
          <div class="combatant-card">
            <span class="combatant-avatar">{{
              character.name?.slice(0, 1) || "你"
            }}</span>
            <h3>{{ character.name || "玩家角色" }}</h3>
            <span>你的角色</span
            ><GaugeMeter
              v-if="character.gauges?.生命"
              name="生命"
              :gauge="character.gauges.生命"
              compact
            />
          </div>
          <div class="encounter-divider">
            <Icon name="swords" :size="30" /><span>等待交锋</span>
          </div>
          <div class="combatant-placeholder">
            <Icon name="users" :size="38" />
            <h3>交锋对象</h3>
            <p>战斗接入后显示</p>
          </div>
        </div>
        <div class="stage-footer">
          <span><Icon name="check" :size="13" />角色数据随冒险同步</span
          ><button class="text-button" @click="navigate('character')">
            查看角色档案<Icon name="arrow" :size="14" />
          </button>
        </div>
      </section>
      <section class="card">
        <h3 class="section-label">当前资源</h3>
        <div class="combat-resources">
          <GaugeMeter
            v-for="row in resourceRows(game.state)"
            :key="row.name"
            :name="row.name"
            :gauge="row"
          />
        </div>
        <div v-if="alerts.length" class="combat-alerts">
          <p v-for="alert in alerts" :key="alert">{{ alert }}</p>
        </div>
        <div class="combat-status">
          <h4>当前状态</h4>
          <div v-if="character.statuses?.length" class="status-chips">
            <span
              v-for="status in character.statuses"
              :key="status"
              class="tag"
              >{{ status }}</span
            >
          </div>
          <span v-else class="healthy"
            ><Icon name="check" :size="14" />暂无异常状态</span
          >
        </div>
      </section>
      <section class="card gear-section">
        <div class="stage-heading">
          <h3>随身装备</h3>
          <button class="text-button" @click="navigate('items')">
            查看背包<Icon name="arrow" :size="14" />
          </button>
        </div>
        <div class="gear-list">
          <div v-for="item in game.state.inventory || []" :key="item.name">
            <Icon name="backpack" :size="17" /><span
              ><b>{{ item.name }}</b
              ><small>{{ item.note || "随身物品" }}</small></span
            ><span>×{{ item.qty ?? 1 }}</span>
          </div>
          <div v-if="!game.state.inventory?.length" class="hint">
            还没有随身物品。
          </div>
        </div>
        <p class="hint">
          当前负重 {{ inventoryLoad(game.state.inventory) }} /
          {{ character.capacity || 0 }}
          格。列表展示携带物品，不代表已装备到战斗槽位。
        </p>
      </section>
      <section class="card">
        <h3 class="section-label">角色特质</h3>
        <div class="combat-traits">
          <div v-for="trait in character.traits || []" :key="trait">
            <Icon name="sparkles" :size="16" /><span>{{ trait }}</span>
          </div>
          <p v-if="!character.traits?.length" class="hint">暂无特质。</p>
        </div>
        <p class="hint">进入交锋前，确认资源、状态与可使用的物品。</p>
      </section>
    </div>
  </template>
</template>
<style scoped>
.combat-notice {
  display: flex;
  gap: 14px;
  align-items: center;
  padding: 17px 20px;
  background: var(--brass-wash);
  border: 1px solid #c1a16535;
  border-radius: 11px;
  margin-bottom: 18px;
  color: var(--brass);
}
.combat-notice > div {
  flex: 1;
}
.combat-notice b {
  font-size: 13px;
  font-weight: 500;
}
.combat-notice p {
  font-size: 11px;
  color: var(--text-dim);
  margin: 5px 0 0;
  line-height: 1.8;
}
.combat-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 20px;
}
.combat-metrics > .card {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 7px;
}
.combat-metrics svg {
  color: var(--text-faint);
  grid-column: 2;
  grid-row: 1/3;
}
.combat-metrics span {
  font-size: 11px;
  color: var(--text-dim);
}
.combat-metrics b {
  font-size: 31px;
  font-weight: 600;
  line-height: 1.3;
}
.combat-metrics small {
  grid-column: 1/-1;
  font-size: 10px;
  color: var(--text-faint);
}
.combat-layout {
  display: grid;
  grid-template-columns: 1.45fr 1fr;
  gap: 18px;
  align-items: start;
}
.stage-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.stage-heading h3 {
  font-size: 13px;
  font-weight: 600;
  margin: 0;
}
.encounter-preview {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 85px minmax(0, 1fr);
  align-items: center;
  gap: 15px;
  padding: 25px 0;
}
.combatant-card,
.combatant-placeholder {
  border: 1px solid var(--line);
  border-radius: 12px;
  min-height: 219px;
  padding: 20px 15px;
  text-align: center;
  background: var(--ink-860);
}
.combatant-avatar {
  width: 64px;
  height: 64px;
  background: radial-gradient(ellipse at 50% 0, #394738, #222d27);
  display: grid;
  place-items: center;
  border: 1px solid #83977940;
  border-radius: 15px;
  color: var(--brass);
  font-family: var(--serif);
  font-size: 29px;
  margin: 0 auto 11px;
}
.combatant-card h3 {
  font-size: 16px;
  margin: 3px 0;
}
.combatant-card > span:not(.combatant-avatar) {
  font-size: 10px;
  color: var(--text-faint);
}
.combatant-card > .meter {
  margin-top: 20px;
  text-align: left;
}
.encounter-divider {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: var(--brass-dim);
}
.encounter-divider span {
  font-size: 10px;
  color: var(--text-faint);
  white-space: nowrap;
}
.combatant-placeholder {
  border-style: dashed;
  color: var(--text-faint);
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}
.combatant-placeholder h3 {
  font-size: 13px;
  font-weight: 400;
  margin: 15px 0 0;
}
.combatant-placeholder p {
  font-size: 10px;
  margin: 5px 0 0;
}
.stage-footer {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  border-top: 1px solid var(--line);
  padding-top: 14px;
}
.stage-footer > span {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 10px;
  color: var(--text-faint);
}
.combat-resources {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 23px 19px;
  margin-top: 20px;
}
.combat-status {
  margin-top: 25px;
}
.combat-status h4 {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-faint);
  margin: 0 0 9px;
}
.healthy {
  display: flex;
  gap: 7px;
  align-items: center;
  font-size: 11px;
  color: var(--moss);
}
.status-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.combat-alerts {
  margin-top: 18px;
  border: 1px solid #e0a16335;
  border-radius: 8px;
  background: #e0a16305;
  padding: 8px 12px;
  color: var(--ember);
  font-size: 11px;
}
.gear-list {
  margin-top: 14px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 20px;
}
.gear-list > div {
  display: flex;
  gap: 9px;
  align-items: center;
  padding: 9px 0;
}
.gear-list svg {
  color: var(--text-faint);
}
.gear-list > div > span:nth-child(2) {
  flex: 1;
}
.gear-list b {
  font-size: 12px;
  font-weight: 500;
}
.gear-list small {
  font-size: 10px;
  color: var(--text-faint);
  display: block;
}
.gear-list > div > span:last-child {
  font-size: 11px;
  color: var(--text-dim);
}
.combat-traits > div {
  display: flex;
  gap: 10px;
  font-size: 12px;
  line-height: 1.8;
  color: var(--text-dim);
  margin-top: 13px;
}
.combat-traits svg {
  color: var(--brass);
  margin-top: 3px;
}
@media (max-width: 1250px) {
  .combat-layout {
    grid-template-columns: 1.2fr 1fr;
  }
  .encounter-preview {
    gap: 10px;
    grid-template-columns: minmax(0, 1fr) 55px minmax(0, 1fr);
  }
  .combatant-card,
  .combatant-placeholder {
    padding: 17px 12px;
  }
  .stage-footer {
    flex-wrap: wrap;
  }
}
@media (max-width: 850px) {
  .combat-layout {
    grid-template-columns: 1fr;
  }
  .combat-metrics {
    gap: 10px;
  }
  .combat-metrics > .card {
    padding: 16px;
  }
  .combat-metrics b {
    font-size: 26px;
  }
  .combat-notice > .tag {
    display: none;
  }
}
@media (max-width: 550px) {
  .combat-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .combat-metrics svg {
    width: 18px;
  }
  .combat-notice {
    padding: 14px;
  }
  .gear-list {
    grid-template-columns: 1fr;
  }
  .encounter-preview {
    grid-template-columns: minmax(0, 1fr) 36px minmax(0, 1fr);
  }
  .encounter-divider span {
    font-size: 8px;
  }
  .combatant-card > .meter {
    font-size: 10px;
  }
}
</style>
