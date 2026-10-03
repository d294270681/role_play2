<script setup>
import { computed } from "vue";
import Icon from "../Icon.vue";
import ClockDial from "../ClockDial.vue";
import { game } from "../../store.js";
const clocks = computed(() => game.state?.clocks || []);
</script>
<template>
  <div v-if="!game.loaded" class="empty-hint">
    载入存档后，可以追踪调查进展、期限或逐步逼近的威胁。
  </div>
  <template v-else>
    <div class="panel-toolbar">
      <span class="hint"
        >目标与威胁出现后解锁，进度会根据实际行动和事件自动结算。</span
      >
    </div>
    <div class="clocks-grid">
      <article
        v-for="(clock, index) in clocks"
        :key="index + ':' + clock.name"
        class="card clock-card"
        :class="{ complete: clock.value >= clock.max }"
      >
        <div class="clock-top">
          <span
            class="tag"
            :class="clock.value >= clock.max ? 'complete-tag' : 'subtle'"
            >{{ clock.value >= clock.max ? "已达上限" : "进行中" }}</span
          ><span class="hint">{{ clock.value }} / {{ clock.max }} 格</span>
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
                  ? "留意接下来的剧情与结算"
                  : "还剩 " + (clock.max - clock.value) + " 格"
              }}
            </p>
          </div>
        </div>
        <div class="clock-consequence">
          <span>满格后果</span>
          <p>{{ clock.consequence || "具体发展将随剧情揭示。" }}</p>
        </div>
      </article>
      <div v-if="!clocks.length" class="empty-hint">
        <Icon name="target" :size="30" />
        <p>
          暂未出现需要追踪的目标或威胁。探索与事件会让新的进度钟出现在这里。
        </p>
      </div>
    </div>
  </template>
</template>
<style scoped>
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
.clocks-grid > .empty-hint {
  grid-column: 1/-1;
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
