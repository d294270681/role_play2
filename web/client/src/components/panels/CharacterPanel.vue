<script setup>
import { computed, ref, watch } from "vue";

import { applyEdit, game, generateImage, notify } from "../../store.js";
import { ATTRS, SKILLS, SKILL_ATTR, gaugeKind, gaugePercent } from "../../util.js";

const ch = computed(() => game.state?.character || {});
const gauges = computed(() => Object.entries(ch.value.gauges || {}));
const xp = computed(() => Number(ch.value.xp) || 0);

const portraitBusy = ref(false);
const busyGauge = ref("");

function attrValue(name) {
  return Number(ch.value.attributes?.[name]) || 0;
}
function skillValue(name) {
  return Number(ch.value.skills?.[name]) || 0;
}

async function setAttr(name, value) {
  const v = Number(value);
  if (!Number.isFinite(v) || v === attrValue(name)) return;
  await applyEdit({ op: "set_attr", name, value: v });
}

async function setSkill(name, value) {
  const v = Number(value);
  if (!Number.isFinite(v) || v === skillValue(name)) return;
  await applyEdit({ op: "set_skill", name, value: v });
}

async function setGauge(name, field, value) {
  if (field === "value") await applyEdit({ op: "set_gauge", name, value: Number(value) });
  else await applyEdit({ op: "set_gauge", name, max: Number(value) });
}

async function bumpGauge(name, delta) {
  const g = ch.value.gauges?.[name];
  if (!g) return;
  busyGauge.value = name;
  await applyEdit({ op: "set_gauge", name, value: (Number(g.value) || 0) + delta });
  busyGauge.value = "";
}

// 新增仪表
const newGaugeName = ref("");
const newGaugeMax = ref(10);
async function addGauge() {
  const name = newGaugeName.value.trim();
  if (!name) return;
  if (ch.value.gauges?.[name]) {
    notify(`仪表「${name}」已存在`, "warn");
    return;
  }
  const ok = await applyEdit({ op: "set_gauge", name, value: 0, max: Number(newGaugeMax.value) || 10 });
  if (ok) {
    newGaugeName.value = "";
    newGaugeMax.value = 10;
  }
}
async function removeGauge(name) {
  await applyEdit({ op: "set_gauge", name, value: 0, max: 0 });
}

// 特质 / 状态 chips
const newTrait = ref("");
const newStatus = ref("");
async function addTrait() {
  const t = newTrait.value.trim();
  if (!t) return;
  if (await applyEdit({ op: "add_trait", text: t })) newTrait.value = "";
}
async function addStatus() {
  const s = newStatus.value.trim();
  if (!s) return;
  if (await applyEdit({ op: "add_status", text: s })) newStatus.value = "";
}

// 经验加点（core §6.2：技能 N 级花 N×3，属性 N 点花 N×5，新特质 6）
const xpKind = ref("skill");
const xpName = ref("");
const xpTarget = ref(1);

const xpTargets = computed(() => {
  if (xpKind.value === "skill") return SKILLS.map((n) => ({ label: `${n}（当前 ${skillValue(n)} 级）`, value: n }));
  if (xpKind.value === "attr") return ATTRS.map((n) => ({ label: `${n}（当前 ${attrValue(n)} 点）`, value: n }));
  return [];
});

const xpCost = computed(() => {
  const to = Number(xpTarget.value) || 0;
  if (xpKind.value === "skill") return to * 3;
  if (xpKind.value === "attr") return to * 5;
  return 6;
});

watch(xpKind, () => {
  xpName.value = "";
  xpTarget.value = 1;
});

async function spend() {
  const name = xpName.value;
  if (xpKind.value === "trait") {
    const t = name.trim();
    if (!t) return;
    if (await applyEdit({ op: "spend_xp", kind: "trait", name: t })) xpName.value = "";
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
  <div v-if="!game.loaded" class="empty-hint">还没有载入存档。</div>

  <template v-else>
    <!-- 头像 -->
    <section class="card portrait-card">
      <div class="portrait">
        <img v-if="game.portraitUrl" :src="game.portraitUrl" alt="角色头像" />
        <div v-else class="portrait-empty">
          <span class="ph">?</span>
          <span class="ph-text">尚无头像</span>
        </div>
      </div>
      <div class="portrait-info">
        <div class="ch-name">{{ ch.name || "无名者" }}</div>
        <div class="ch-concept">{{ ch.concept || "（无设定）" }}</div>
        <div class="ch-goal" v-if="ch.goal">目标：{{ ch.goal }}</div>
        <div class="ch-weak" v-if="ch.weakness">弱点：{{ ch.weakness }}</div>
        <button class="img-btn" :disabled="portraitBusy || !game.comfy?.online" @click="makePortrait">
          {{ portraitBusy ? "生成中…" : game.portraitUrl ? "重新生成头像" : "生成头像" }}
        </button>
        <div v-if="!game.comfy?.online" class="img-hint">ComfyUI 离线，无法出图</div>
      </div>
    </section>

    <section class="card">
      <h4 class="section-label">六属性</h4>
      <div class="attr-grid">
        <div v-for="a in ATTRS" :key="a" class="attr">
          <span class="attr-name">{{ a }}</span>
          <n-input-number
            :value="attrValue(a)"
            :min="1"
            :max="5"
            size="small"
            :show-button="true"
            button-placement="compact"
            @change="(v) => setAttr(a, v)"
          />
        </div>
      </div>
      <div class="stat-line">
        <span>防御 {{ ch.defense ?? 0 }}</span>
        <span>负重 {{ ch.capacity ?? 0 }}</span>
      </div>
    </section>

    <section class="card">
      <h4 class="section-label">十三技能</h4>
      <div class="skill-list">
        <div v-for="s in SKILLS" :key="s" class="skill" :class="{ nonzero: skillValue(s) > 0 }">
          <span class="skill-name">{{ s }}</span>
          <span class="skill-attr">{{ SKILL_ATTR[s] }}</span>
          <n-input-number
            :value="skillValue(s)"
            :min="0"
            :max="3"
            size="tiny"
            :show-button="true"
            button-placement="compact"
            @change="(v) => setSkill(s, v)"
          />
        </div>
      </div>
    </section>

    <section class="card">
      <h4 class="section-label">仪表</h4>
      <div v-for="[name, g] in gauges" :key="name" class="gauge">
        <div class="gauge-head">
          <span class="gauge-name">{{ name }}</span>
          <div class="gauge-ctrl">
            <n-input-number
              :value="Number(g.value) || 0"
              size="tiny"
              :min="0"
              @change="(v) => setGauge(name, 'value', v)"
            />
            <span class="slash">/</span>
            <n-input-number
              :value="Number(g.max) || 0"
              size="tiny"
              :min="0"
              @change="(v) => setGauge(name, 'max', v)"
            />
            <button class="mini" :disabled="busyGauge === name" @click="bumpGauge(name, 1)">+1</button>
            <button class="mini" :disabled="busyGauge === name" @click="bumpGauge(name, -1)">−1</button>
            <button class="mini danger" title="归零（后端无删除仪表的操作）" @click="removeGauge(name)">✕</button>
          </div>
        </div>
        <div class="gauge-rail">
          <div class="gauge-fill" :class="gaugeKind(name)" :style="{ width: gaugePercent(g) + '%' }" />
        </div>
      </div>

      <div class="add-row">
        <n-input v-model:value="newGaugeName" size="small" placeholder="新仪表名" />
        <n-input-number v-model:value="newGaugeMax" size="small" :min="1" :max="999" style="width: 78px" />
        <n-button size="small" type="primary" ghost @click="addGauge">添加</n-button>
      </div>
    </section>

    <section class="card">
      <h4 class="section-label">特质 / 状态</h4>
      <div class="chip-label">特质（最多 4）</div>
      <div class="chips">
        <span v-for="t in ch.traits || []" :key="t" class="chip trait" :title="t" @click="applyEdit({ op: 'remove_trait', text: t })">
          {{ t }} <i>✕</i>
        </span>
        <span v-if="!(ch.traits || []).length" class="none">暂无</span>
      </div>
      <div class="add-row tight">
        <n-input v-model:value="newTrait" size="small" placeholder="新特质" @keyup.enter="addTrait" />
        <n-button size="small" ghost @click="addTrait">加</n-button>
      </div>

      <div class="chip-label" style="margin-top: 10px">状态</div>
      <div class="chips">
        <span v-for="s in ch.statuses || []" :key="s" class="chip status" @click="applyEdit({ op: 'remove_status', text: s })">
          {{ s }} <i>✕</i>
        </span>
        <span v-if="!(ch.statuses || []).length" class="none">暂无</span>
      </div>
      <div class="add-row tight">
        <n-input v-model:value="newStatus" size="small" placeholder="新状态" @keyup.enter="addStatus" />
        <n-button size="small" ghost @click="addStatus">加</n-button>
      </div>
    </section>

    <section class="card">
      <h4 class="section-label">经验 · §6.2</h4>
      <div class="xp-line">
        可用 <b>{{ xp }}</b> 经验<span class="dim">（累计 {{ ch.xp_total ?? 0 }}）</span>
      </div>
      <div class="add-row">
        <n-select
          v-model:value="xpKind"
          size="small"
          style="width: 92px"
          :options="[
            { label: '技能', value: 'skill' },
            { label: '属性', value: 'attr' },
            { label: '特质', value: 'trait' },
          ]"
        />
        <n-input
          v-if="xpKind === 'trait'"
          v-model:value="xpName"
          size="small"
          placeholder="特质名"
          style="flex: 1"
        />
        <n-select
          v-else
          v-model:value="xpName"
          size="small"
          style="flex: 1"
          :options="xpTargets"
          placeholder="选择目标"
        />
        <n-input-number
          v-if="xpKind !== 'trait'"
          v-model:value="xpTarget"
          size="small"
          :min="1"
          :max="xpKind === 'attr' ? 5 : 3"
          style="width: 66px"
        />
        <n-button size="small" type="primary" :disabled="!xpName" @click="spend">
          花 {{ xpCost }}
        </n-button>
      </div>
      <p class="hint">技能升到 N 级花 N×3，属性升到 N 点花 N×5，新特质 6 点。</p>
    </section>
  </template>
</template>

<style scoped>
.card { display: flex; flex-direction: column; gap: 9px; }

.portrait-card { display: flex; gap: 12px; }
.portrait {
  width: 86px;
  height: 108px;
  flex-shrink: 0;
  border-radius: 9px;
  overflow: hidden;
  border: 1px solid var(--line);
  background: #0b0e12;
  display: grid;
  place-items: center;
}
.portrait img { width: 100%; height: 100%; object-fit: cover; }
.portrait-empty { text-align: center; color: var(--text-faint); }
.portrait-empty .ph { font-family: var(--serif); font-size: 30px; display: block; opacity: 0.5; }
.portrait-empty .ph-text { font-size: 10.5px; }
.portrait-info { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.ch-name { font-family: var(--serif); font-size: 16px; }
.ch-concept, .ch-goal, .ch-weak { font-size: 11.5px; color: var(--text-dim); line-height: 1.6; }
.ch-weak { color: var(--text-faint); }
.img-btn {
  margin-top: 5px;
  align-self: flex-start;
  padding: 4px 11px;
  border-radius: 7px;
  border: 1px solid var(--brass-dim);
  background: rgba(212, 169, 74, 0.1);
  color: var(--brass);
  font-size: 11.5px;
  cursor: pointer;
}
.img-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.img-hint { font-size: 10.5px; color: var(--text-faint); }

.attr-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; }
.attr { display: flex; flex-direction: column; gap: 2px; }
.attr-name { font-size: 11.5px; color: var(--text-dim); text-align: center; }
.stat-line {
  display: flex;
  gap: 14px;
  font-size: 11.5px;
  color: var(--text-faint);
  border-top: 1px dashed var(--line-soft);
  padding-top: 7px;
}

.skill-list { display: grid; grid-template-columns: 1fr 1fr; gap: 5px 10px; }
.skill { display: flex; align-items: center; gap: 5px; }
.skill-name { font-size: 11.5px; color: var(--text-faint); flex: 1; }
.skill.nonzero .skill-name { color: var(--text); }
.skill-attr { font-size: 9.5px; color: var(--text-faint); opacity: 0.6; }

.gauge { display: flex; flex-direction: column; gap: 4px; }
.gauge-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.gauge-name { font-size: 12px; color: var(--text); }
.gauge-ctrl { display: flex; align-items: center; gap: 3px; }
.gauge-ctrl .slash { color: var(--text-faint); font-size: 11px; }
.mini {
  width: 22px;
  height: 20px;
  border-radius: 5px;
  border: 1px solid var(--line);
  background: #171c24;
  color: var(--text-dim);
  font-size: 10.5px;
  cursor: pointer;
  line-height: 1;
}
.mini:hover:not(:disabled) { color: var(--brass); border-color: var(--brass-dim); }
.mini:disabled { opacity: 0.4; }
.mini.danger:hover { color: var(--blood); border-color: rgba(194, 80, 76, 0.5); }

.add-row { display: flex; align-items: center; gap: 6px; }
.add-row.tight { margin-top: 2px; }

.chip-label { font-size: 10.5px; letter-spacing: 0.1em; color: var(--text-faint); }
.chips { display: flex; flex-wrap: wrap; gap: 5px; }
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 12px;
  font-size: 11px;
  cursor: pointer;
  border: 1px solid;
}
.chip i { font-style: normal; opacity: 0.5; font-size: 9px; }
.chip:hover i { opacity: 1; }
.chip.trait { color: var(--brass); border-color: rgba(212, 169, 74, 0.4); background: rgba(212, 169, 74, 0.08); }
.chip.status { color: var(--azure); border-color: rgba(95, 149, 216, 0.4); background: rgba(95, 149, 216, 0.08); }
.none { font-size: 11px; color: var(--text-faint); }

.xp-line { font-size: 12.5px; color: var(--text-dim); }
.xp-line b { color: var(--brass); font-size: 15px; }
.xp-line .dim { color: var(--text-faint); font-size: 11px; margin-left: 6px; }
.hint { font-size: 10.5px; color: var(--text-faint); margin: 0; line-height: 1.7; }
</style>
