<script setup>
import { computed, ref, watch } from "vue";
import { applyEdit, game, generateImage, notify } from "../../store.js";
import { ATTRS, SKILLS, SKILL_ATTR } from "../../util.js";
import AttributeRadar from "../AttributeRadar.vue";
import GaugeMeter from "../GaugeMeter.vue";
import Icon from "../Icon.vue";
import { resourceRows } from "../../ui.js";
const ch = computed(() => game.state?.character || {});
const gauges = computed(() => resourceRows(game.state));
const xp = computed(() => Number(ch.value.xp) || 0);
const portraitBusy = ref(false);
function attrValue(name) {
  return Number(ch.value.attributes?.[name]) || 0;
}
function skillValue(name) {
  return Number(ch.value.skills?.[name]) || 0;
}
// 经验加点：跳级逐级累计，费用与后端 core §6.2 一致。
const xpKind = ref("skill");
const xpName = ref("");
const xpTarget = ref(1);

const xpTargets = computed(() => {
  if (xpKind.value === "skill")
    return SKILLS.map((n) => ({
      label: `${n}（当前 ${skillValue(n)} 级）`,
      value: n,
    }));
  if (xpKind.value === "attr")
    return ATTRS.map((n) => ({
      label: `${n}（当前 ${attrValue(n)} 点）`,
      value: n,
    }));
  return [];
});

const xpCost = computed(() => {
  const to = Number(xpTarget.value) || 0;
  if (xpKind.value === "skill" || xpKind.value === "attr") {
    const from =
      xpKind.value === "skill"
        ? skillValue(xpName.value)
        : attrValue(xpName.value);
    return to > from
      ? (((from + 1 + to) * (to - from)) / 2) *
          (xpKind.value === "skill" ? 3 : 5)
      : 0;
  }
  return 6;
});

watch(xpKind, () => {
  xpName.value = "";
  xpTarget.value = 1;
});

watch(xpName, (name) => {
  if (!name || xpKind.value === "trait") return;
  const current = xpKind.value === "skill" ? skillValue(name) : attrValue(name);
  xpTarget.value = Math.min(current + 1, xpKind.value === "skill" ? 3 : 5);
});

async function spend() {
  const name = xpName.value;
  if (xpKind.value === "trait") {
    const t = name.trim();
    if (!t) return;
    if (await applyEdit({ op: "spend_xp", kind: "trait", name: t }))
      xpName.value = "";
    return;
  }
  if (!name) return;
  const to = Number(xpTarget.value) || 0;
  await applyEdit({ op: "spend_xp", kind: xpKind.value, name, to });
}

async function makePortrait() {
  portraitBusy.value = true;
  const data = await generateImage({ kind: "portrait" });
  portraitBusy.value = false;
  if (data) notify("头像已生成", "success");
}
</script>
<template>
  <div v-if="!game.loaded" class="empty-hint">
    还没有角色档案。打开「冒险与存档」，载入或新建一个角色。
  </div>
  <template v-else>
    <div class="panel-toolbar">
      <span class="hint"
        >资源、状态与经验随冒险结算；提升能力需要消耗已获得的经验。</span
      >
    </div>
    <div class="character-sheet">
      <section class="card character-hero">
        <div class="portrait">
          <button
            v-if="game.portraitUrl"
            class="portrait-image"
            title="放大角色头像"
            @click="game.lightbox = { url: game.portraitUrl, prompt: ch.name }"
          >
            <img :src="game.portraitUrl" :alt="ch.name + '的头像'" />
          </button>
          <div v-else class="portrait-empty">
            <Icon name="user" :size="52" /><span>角色肖像</span>
          </div>
        </div>
        <div class="character-intro">
          <div class="eyebrow">
            玩家角色<span class="tag gold">防御 {{ ch.defense ?? 0 }}</span>
          </div>
          <h2>{{ ch.name || "无名者" }}</h2>
          <p class="concept">{{ ch.concept || "你的故事仍在展开" }}</p>
          <div v-if="ch.goal" class="character-detail">
            <span>目标</span>{{ ch.goal }}
          </div>
          <div v-if="ch.weakness" class="character-detail">
            <span>弱点</span>{{ ch.weakness }}
          </div>
          <details v-if="ch.background">
            <summary>角色背景</summary>
            <p>{{ ch.background }}</p>
          </details>
        </div>
        <div class="hero-side">
          <span class="hero-xp">{{ xp }}<small>可用经验</small></span
          ><button
            v-if="game.comfy?.available"
            class="secondary-button"
            :disabled="portraitBusy || game.busy"
            @click="makePortrait"
          >
            <Icon name="image" :size="15" />{{
              portraitBusy
                ? "生成中…"
                : game.portraitUrl
                  ? "重新生成头像"
                  : "生成头像"
            }}</button
          ><button v-else class="text-button" @click="game.settingsOpen = true">
            <Icon name="image" :size="14" />配置角色生图
          </button>
        </div>
      </section>

      <section class="card attributes-card">
        <h3 class="section-label">六维属性</h3>
        <div class="attribute-content">
          <AttributeRadar :attributes="ch.attributes || {}" />
          <div class="attribute-list">
            <div v-for="attr in ATTRS" :key="attr" class="attribute-row">
              <span>{{ attr }}</span>
              <div class="attribute-dots">
                <i
                  v-for="i in 5"
                  :key="i"
                  :class="{ filled: i <= attrValue(attr) }"
                ></i>
              </div>
              <b>{{ attrValue(attr) }}</b>
            </div>
          </div>
        </div>
      </section>
      <section class="card resources-card">
        <h3 class="section-label">资源与状态</h3>
        <div class="character-gauges">
          <div v-for="row in gauges" :key="row.name" class="resource-block">
            <GaugeMeter :name="row.name" :gauge="row" />
          </div>
        </div>
        <div class="traits-section">
          <h4>特质</h4>
          <div class="chips">
            <span
              v-for="trait in ch.traits || []"
              :key="trait"
              class="chip trait"
              >{{ trait }}</span
            ><span v-if="!ch.traits?.length" class="hint">暂无特质</span>
          </div>
        </div>
        <div class="traits-section">
          <h4>当前状态</h4>
          <div class="chips">
            <span
              v-for="status in ch.statuses || []"
              :key="status"
              class="chip status"
              >{{ status }}</span
            ><span v-if="!ch.statuses?.length" class="healthy-state"
              ><Icon name="check" :size="14" />暂无异常状态</span
            >
          </div>
        </div>
      </section>
      <section class="card skills-card">
        <h3 class="section-label">技能专长</h3>
        <div class="skill-grid">
          <div
            v-for="skill in SKILLS"
            :key="skill"
            class="skill-item"
            :class="{ trained: skillValue(skill) > 0 }"
          >
            <span
              ><b>{{ skill }}</b
              ><small>{{ SKILL_ATTR[skill] }}</small></span
            >
            <div
              class="skill-level"
              :aria-label="skill + ' ' + skillValue(skill) + '级'"
            >
              <i
                v-for="i in 3"
                :key="i"
                :class="{ filled: i <= skillValue(skill) }"
              ></i
              ><b>{{ skillValue(skill) }}</b>
            </div>
          </div>
        </div>
      </section>
      <section class="card growth-card">
        <h3 class="section-label">成长与经验</h3>
        <div class="growth-summary">
          <Icon name="sparkles" :size="26" /><span
            ><b>{{ xp }}</b
            >可用经验<small>累计获得 {{ ch.xp_total ?? 0 }}</small></span
          >
        </div>
        <div class="growth-form">
          <n-select
            v-model:value="xpKind"
            size="small"
            :disabled="game.busy"
            :options="[
              { label: '提升技能', value: 'skill' },
              { label: '提升属性', value: 'attr' },
              { label: '学习特质', value: 'trait' },
            ]"
          /><n-input
            v-if="xpKind === 'trait'"
            v-model:value="xpName"
            size="small"
            :disabled="game.busy"
            placeholder="新特质名称"
          /><n-select
            v-else
            v-model:value="xpName"
            size="small"
            :disabled="game.busy"
            :options="xpTargets"
            placeholder="选择成长目标"
          /><n-input-number
            v-if="xpKind !== 'trait'"
            v-model:value="xpTarget"
            size="small"
            :disabled="game.busy"
            :min="1"
            :max="xpKind === 'attr' ? 5 : 3"
          /><n-button
            type="primary"
            :disabled="game.busy || !xpName || xpCost <= 0 || xpCost > xp"
            @click="spend"
            >消耗 {{ xpCost }} 点经验</n-button
          >
        </div>
        <p class="hint">
          技能每级 N×3，属性每级 N×5，跳级逐级累计；新特质 6
          点。建议在安全地点休整时成长。
        </p>
      </section>
    </div>
  </template>
</template>
<style scoped>
.character-sheet {
  display: grid;
  grid-template-columns: 1.1fr 1fr;
  gap: 18px;
  align-items: start;
}
.character-hero {
  grid-column: 1/-1;
  display: flex;
  gap: 24px;
  align-items: center;
}
.portrait {
  width: 116px;
  height: 142px;
  flex-shrink: 0;
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow: hidden;
  background: radial-gradient(ellipse at 50% 0, #314339, #172127);
  display: grid;
  place-items: center;
}
.portrait-image {
  border: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  background: none;
  cursor: zoom-in;
}
.portrait-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.portrait-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: #83a093;
}
.portrait-empty span {
  font-size: 10px;
  color: var(--text-faint);
}
.character-intro {
  flex: 1;
  min-width: 0;
}
.eyebrow {
  display: flex;
  gap: 12px;
  align-items: center;
  font-size: 10px;
  color: var(--text-faint);
}
.character-intro h2 {
  font-family: var(--serif);
  font-size: 29px;
  margin: 5px 0;
}
.concept {
  font-size: 13px;
  color: var(--text-dim);
  margin: 0 0 12px;
}
.character-detail {
  display: flex;
  gap: 12px;
  font-size: 12px;
  line-height: 1.9;
  color: var(--text-dim);
}
.character-detail > span {
  color: var(--text-faint);
  white-space: nowrap;
}
.character-intro details {
  font-size: 11px;
  color: var(--text-dim);
  margin-top: 8px;
}
.character-intro summary {
  cursor: pointer;
  color: var(--text-faint);
}
.character-intro details p {
  line-height: 1.9;
}
.hero-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 16px;
}
.hero-xp {
  font-size: 28px;
  font-weight: 600;
  color: var(--brass);
  text-align: right;
}
.hero-xp small {
  display: block;
  font-size: 10px;
  color: var(--text-faint);
  font-weight: 400;
}
.attribute-content {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  align-items: center;
  gap: 14px;
}
.attribute-list {
  display: flex;
  flex-direction: column;
  gap: 17px;
}
.attribute-row {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
}
.attribute-row > span {
  color: var(--text-dim);
}
.attribute-row > b {
  width: 12px;
  font-size: 15px;
}
.attribute-dots {
  display: flex;
  gap: 4px;
  margin-left: auto;
}
.attribute-dots i {
  width: 7px;
  height: 7px;
  background: var(--ink-740);
  border: 1px solid var(--line);
  border-radius: 2px;
}
.attribute-dots .filled {
  background: var(--brass);
  border-color: var(--brass-dim);
}
.character-gauges {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 22px 20px;
  margin-top: 19px;
}
.gauge-edit {
  display: flex;
  gap: 3px;
  flex-wrap: wrap;
  align-items: center;
  margin-top: 10px;
}
.gauge-edit > .n-input-number {
  width: 65px;
}
.gauge-edit > span {
  color: var(--text-faint);
}
.mini {
  padding: 4px 6px;
  border: 1px solid var(--line);
  border-radius: 5px;
  color: var(--text-dim);
  background: var(--ink-860);
  font-size: 10px;
}
.traits-section {
  margin-top: 25px;
}
.traits-section h4 {
  font-size: 11px;
  color: var(--text-faint);
  font-weight: 500;
  margin: 0 0 9px;
}
.chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  line-height: 1.7;
  border: 1px solid #d2a44f38;
  background: var(--brass-wash);
  border-radius: 7px;
  padding: 5px 9px;
  color: var(--brass);
}
.chip.status {
  border-color: #7998ba45;
  color: var(--azure);
  background: #7ca6d00a;
}
.skill-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 20px;
}
.skill-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 7px 0;
  border-bottom: 1px solid var(--line-soft);
  gap: 6px;
}
.skill-item > span b {
  display: block;
  color: var(--text-dim);
  font-weight: 500;
  font-size: 12px;
}
.skill-item small {
  display: block;
  font-size: 9px;
  color: var(--text-faint);
}
.skill-level {
  display: flex;
  gap: 4px;
  align-items: center;
}
.skill-level i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ink-740);
  border: 1px solid var(--line);
}
.skill-level i.filled {
  background: var(--moss);
  border-color: var(--moss);
}
.skill-level b {
  font-size: 11px;
  color: var(--text-faint);
  margin-left: 5px;
}
.trained > span b {
  color: var(--text);
}
.growth-summary {
  display: flex;
  gap: 14px;
  align-items: center;
  color: var(--brass);
  padding: 8px 0 17px;
}
.growth-summary b {
  font-size: 29px;
  margin-right: 9px;
}
.growth-summary span {
  font-size: 12px;
  color: var(--text-dim);
}
.growth-summary small {
  display: block;
  font-size: 11px;
  color: var(--text-faint);
  margin-top: 2px;
}
.growth-form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 9px;
}
.growth-form > .n-button:last-child {
  grid-column: 1/-1;
}
.hint {
  margin-bottom: 0;
}
@media (max-width: 1200px) {
  .character-sheet {
    grid-template-columns: 1fr 1fr;
  }
  .attribute-content {
    grid-template-columns: 1fr;
  }
  .radar {
    max-width: 255px;
  }
  .attribute-list {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .attribute-row {
    gap: 7px;
  }
  .hero-side {
    max-width: 150px;
  }
  .character-gauges {
    grid-template-columns: 1fr;
    gap: 17px;
  }
}
@media (max-width: 780px) {
  .character-sheet {
    grid-template-columns: 1fr;
    gap: 12px;
  }
  .character-hero {
    flex-wrap: wrap;
    gap: 16px;
  }
  .hero-side {
    max-width: none;
    flex-direction: row;
    align-items: center;
    width: 100%;
    justify-content: space-between;
  }
  .hero-xp {
    font-size: 22px;
  }
  .hero-xp small {
    display: inline;
    margin-left: 8px;
  }
  .portrait {
    width: 84px;
    height: 108px;
  }
  .character-intro h2 {
    font-size: 24px;
  }
  .character-gauges {
    grid-template-columns: 1fr 1fr;
  }
  .skills-card {
    grid-column: auto;
  }
  .attribute-content {
    grid-template-columns: 1fr 1fr;
  }
  .attribute-list {
    display: flex;
  }
}
@media (max-width: 460px) {
  .attribute-content {
    grid-template-columns: 1fr;
  }
  .attribute-list {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
  .skill-grid {
    gap: 6px 12px;
  }
  .character-detail {
    font-size: 11px;
  }
  .character-gauges {
    gap: 17px 12px;
  }
}
</style>
