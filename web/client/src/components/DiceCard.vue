<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import { DIFFICULTY_NAMES, signed, tierMeta } from "../util.js";

const props = defineProps({
  result: { type: Object, required: true },
});

const SPIN_MS = 620;
const SPIN_STEP = 55;

const spinning = ref(true);
const faces = ref((props.result.dice || []).map(() => 1));

let timer = null;
let stop = null;

onMounted(() => {
  const real = props.result.dice || [];
  const started = Date.now();
  timer = setInterval(() => {
    faces.value = real.map(() => 1 + Math.floor(Math.random() * 6));
    if (Date.now() - started >= SPIN_MS) {
      clearInterval(timer);
      timer = null;
      faces.value = real.slice();
      spinning.value = false;
    }
  }, SPIN_STEP);
  stop = setTimeout(() => spinning.value = false, SPIN_MS + 120);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
  if (stop) clearTimeout(stop);
});

/**
 * 每颗骰子是否被计入总值。后端只给 kept 的面值集合、不给下标，
 * 这里按多重集差集贪心消费：同值骰一留一弃（如劣势 [5,5,3] 取 [5,3]）时
 * 只标一颗 kept，不会两颗都亮。
 */
const keptFlags = computed(() => {
  const pool = (props.result.kept || []).map(Number);
  return (props.result.dice || []).map((face) => {
    const i = pool.findIndex((k) => k === Number(face));
    if (i < 0) return false;
    pool.splice(i, 1);
    return true;
  });
});

const meta = computed(() => tierMeta(props.result.tier, props.result.tier_index));
const total = computed(() => Number(props.result.total) || 0);
const difficulty = computed(() => Number(props.result.difficulty) || 0);
const margin = computed(() => total.value - difficulty.value);
const difficultyName = computed(
  () => props.result.difficulty_name || DIFFICULTY_NAMES[difficulty.value] || `难度 ${difficulty.value}`,
);
</script>

<template>
  <div class="dice-card" :style="{ '--tier': meta.color, '--tier-glow': meta.glow }">
    <div class="head">
      <span class="badge">判定</span>
      <span class="reason">{{ result.reason || `${result.attr_name || ""}${result.skill_name || ""}`.trim() || "一次判定" }}</span>
    </div>

    <div class="faces" :class="{ spinning }">
      <div
        v-for="(face, i) in faces"
        :key="i"
        class="die"
        :class="{ kept: !spinning && keptFlags[i], dropped: !spinning && !keptFlags[i] }"
      >
        <span class="pip">{{ face }}</span>
      </div>
    </div>

    <div class="math">
      <span class="atom"><i>骰面</i>{{ (result.dice || []).join(" + ") }}<em>取 {{ (result.kept || []).join("、") }}（{{ result.mode || "普通" }}）</em></span>
      <span class="atom"><i>加值</i>{{ result.attr_name }} {{ result.attr }} + {{ result.skill_name }} {{ result.skill }} + {{ signed(result.modifier) }}<template v-if="result.rule_modifier"> + 状态 {{ signed(result.rule_modifier) }}</template><em>= {{ result.bonus }}</em></span>
    </div>

    <div class="verdict">
      <div class="total">
        <span class="num">{{ (result.base ?? 0) }}<em>骰</em> + <span class="num">{{ result.bonus ?? 0 }}<em>加值</em></span> = </span>
        <span class="num big">{{ total }}</span>
        <span class="vs">对难度 {{ difficulty }}<em>{{ difficultyName }}</em></span>
      </div>
      <div class="tier" :class="{ fail: !result.success }">
        {{ result.tier || meta.key }}
        <span class="margin">{{ margin >= 0 ? "过 " + margin : "差 " + Math.abs(margin) }}</span>
      </div>
    </div>

    <div v-if="result.exertion" class="flag">全力以赴（精力 +2 加值）</div>
    <div v-if="result.energy_cost" class="flag">消耗精力 {{ result.energy_cost }}</div>
    <div v-for="effect in result.rule_modifiers || []" :key="effect.source" class="flag">{{ effect.source }} {{ signed(effect.value) }}</div>
    <div v-if="result.disadvantage_sources?.length" class="flag">劣势来源：{{ result.disadvantage_sources.join('、') }}</div>
  </div>
</template>

<style scoped>
.dice-card {
  border: 1px solid color-mix(in srgb, var(--tier) 45%, var(--line));
  border-radius: 12px;
  background: linear-gradient(160deg, #1b212a, #141922);
  padding: 13px 15px;
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.45), inset 0 0 26px color-mix(in srgb, var(--tier) 8%, transparent);
  display: flex;
  flex-direction: column;
  gap: 11px;
}

.head { display: flex; align-items: center; gap: 9px; }
.badge {
  font-size: 10.5px;
  letter-spacing: 0.16em;
  padding: 2px 8px;
  border-radius: 5px;
  color: var(--tier);
  border: 1px solid color-mix(in srgb, var(--tier) 50%, transparent);
  background: color-mix(in srgb, var(--tier) 12%, transparent);
  flex-shrink: 0;
}
.reason { font-family: var(--serif); font-size: 13.5px; color: var(--text); }

.faces { display: flex; gap: 9px; }
.die {
  width: 42px; height: 42px;
  border-radius: 9px;
  display: grid; place-items: center;
  background: #0e1218;
  border: 1px solid var(--line);
  box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.5);
  transition: all 0.25s cubic-bezier(0.2, 0.8, 0.3, 1.2);
}
.die .pip {
  font-family: var(--serif);
  font-size: 19px;
  font-weight: 700;
  color: var(--text-faint);
}
.faces.spinning .die {
  border-color: var(--brass-dim);
  animation: tumble 0.28s ease-in-out infinite alternate;
}
.faces.spinning .die:nth-child(2) { animation-delay: 0.09s; }
.faces.spinning .die:nth-child(3) { animation-delay: 0.18s; }
.faces.spinning .die .pip { color: var(--brass); }
.die.kept {
  border-color: var(--tier);
  background: color-mix(in srgb, var(--tier) 14%, #0e1218);
  box-shadow: 0 0 14px var(--tier-glow), inset 0 -2px 0 rgba(0, 0, 0, 0.4);
}
.die.kept .pip { color: var(--tier); }
.die.dropped { opacity: 0.35; }

@keyframes tumble {
  from { transform: translateY(0) rotate(-4deg); }
  to { transform: translateY(-3px) rotate(4deg); }
}

.math { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--text-dim); }
.atom i {
  font-style: normal;
  color: var(--text-faint);
  margin-right: 8px;
  font-size: 11px;
  letter-spacing: 0.1em;
}
.atom em { font-style: normal; color: var(--text-faint); margin-left: 8px; }

.verdict {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 10px;
  border-top: 1px dashed var(--line-soft);
  flex-wrap: wrap;
}
.total { display: flex; align-items: baseline; gap: 5px; font-size: 13px; color: var(--text-dim); }
.total .num { font-variant-numeric: tabular-nums; color: var(--text); font-weight: 600; }
.total .num em { font-style: normal; font-size: 10.5px; color: var(--text-faint); margin-left: 2px; }
.total .num.big { font-family: var(--serif); font-size: 25px; color: var(--tier); text-shadow: 0 0 16px var(--tier-glow); }
.vs { display: flex; flex-direction: column; font-size: 11px; color: var(--text-faint); line-height: 1.3; }
.vs em { font-style: normal; color: var(--text-dim); }

.tier {
  font-family: var(--serif);
  font-size: 15px;
  letter-spacing: 0.1em;
  color: var(--tier);
  text-shadow: 0 0 14px var(--tier-glow);
  display: flex;
  align-items: center;
  gap: 8px;
}
.tier .margin { font-family: var(--sans); font-size: 11px; letter-spacing: 0; color: var(--text-faint); text-shadow: none; }
.tier.fail { opacity: 0.95; }

.flag {
  font-size: 11px;
  color: var(--text-faint);
  border-left: 2px solid var(--brass-dim);
  padding-left: 8px;
}
</style>
