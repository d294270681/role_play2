<script setup>
import { computed } from "vue";
import Icon from "./Icon.vue";
import ClockDial from "./ClockDial.vue";
import { currentLocation, game, locationDanger, navigate } from "../store.js";
import { dangerWord, currentPeriod } from "../util.js";
const loc = computed(() => currentLocation());
const danger = computed(() => locationDanger(loc.value));
const clues = computed(() =>
  (game.state?.clues || []).filter((clue) => !clue.done),
);
const clocks = computed(() => game.state?.clocks || []);
const scene = computed(() => game.locationImage?.[loc.value?.name] || "");
const party = computed(() => Object.entries(game.state?.party || {}));
</script>
<template>
  <aside class="overview">
    <section class="overview-location">
      <img
        v-if="scene"
        :src="scene"
        :alt="loc?.name"
        class="overview-scene"
        @click="game.lightbox = { url: scene, prompt: loc?.name }"
      />
      <div v-else class="location-art" aria-hidden="true">
        <div class="art-ring"></div>
        <Icon name="map" :size="64" />
      </div>
      <div class="location-details">
        <span class="eyebrow"><Icon name="pin" :size="13" />当前位置</span>
        <h2>{{ loc?.name || game.state?.location || "尚未启程" }}</h2>
        <div class="location-meta">
          <span>{{ currentPeriod(game.state) || "—" }}</span
          ><span v-if="loc" :class="'danger-' + danger"
            >{{ dangerWord(danger) }} · 危险 {{ danger }}</span
          >
        </div>
        <p>{{ loc?.desc || "选择存档，开启这段旅程。" }}</p>
        <button class="text-button" @click="navigate('map')">
          探索地图<Icon name="arrow" :size="15" />
        </button>
      </div>
    </section>
    <section class="overview-card">
      <div class="card-heading">
        <h3><Icon name="target" :size="16" />进度与威胁</h3>
        <button
          class="icon-button"
          title="查看全部进度钟"
          @click="navigate('clocks')"
        >
          <Icon name="chevron" :size="15" />
        </button>
      </div>
      <div
        v-for="clock in clocks.slice(0, 2)"
        :key="clock.name"
        class="overview-clock"
      >
        <ClockDial
          :value="Number(clock.value) || 0"
          :max="Number(clock.max) || 6"
          :label="clock.name"
          :size="65"
        />
        <div>
          <b>{{ clock.name }}</b
          ><small>{{
            clock.value >= clock.max
              ? "已达到上限，请关注后果"
              : "还差 " + (clock.max - clock.value) + " 格达到上限"
          }}</small>
        </div>
      </div>
      <div v-if="!clocks.length" class="soft-empty">
        暂无进度钟，新的进展会记录在这里。
      </div>
    </section>
    <section class="overview-card">
      <div class="card-heading">
        <h3><Icon name="search" :size="16" />正在追踪</h3>
        <span class="count">{{ clues.length }}</span>
      </div>
      <button
        v-for="clue in clues.slice(0, 3)"
        :key="clue.text"
        class="clue-preview"
        @click="navigate('clues')"
      >
        <span class="clue-dot"></span><span>{{ clue.text }}</span>
      </button>
      <div v-if="!clues.length" class="soft-empty">
        {{ game.state?.character?.goal || "新的发现会出现在你的线索板。" }}
      </div>
      <button class="text-button" @click="navigate('clues')">
        打开线索板<Icon name="arrow" :size="15" />
      </button>
    </section>
    <section v-if="party.length" class="overview-card">
      <div class="card-heading">
        <h3><Icon name="users" :size="16" />同行者</h3>
        <button
          class="icon-button"
          title="查看人物关系"
          @click="navigate('relations')"
        >
          <Icon name="chevron" :size="15" />
        </button>
      </div>
      <button
        v-for="[name, member] in party.slice(0, 3)"
        :key="name"
        class="party-preview"
        @click="navigate('relations')"
      >
        <span class="avatar-letter">{{ name.slice(0, 1) }}</span
        ><span
          ><b>{{ name }}</b
          ><small>{{ member.statuses?.join(" · ") || "同行中" }}</small></span
        >
      </button>
    </section>
    <div v-if="game.state?.pending_event" class="pending-preview">
      <Icon name="activity" :size="18" />
      <div>
        <b>有事件待处理</b>
        <p>{{ game.state.pending_event.name }}</p>
        <button class="text-button" @click="navigate('events')">
          查看事件<Icon name="arrow" :size="14" />
        </button>
      </div>
    </div>
  </aside>
</template>
<style scoped>
.overview {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: 4px;
}
.overview-location {
  border: 1px solid var(--line-soft);
  background: var(--ink-820);
  border-radius: 14px;
  overflow: hidden;
  flex-shrink: 0;
}
.location-art {
  height: 118px;
  display: grid;
  place-items: center;
  position: relative;
  overflow: hidden;
  background: radial-gradient(
    ellipse at 70% 10%,
    #314138,
    #1c2828 60%,
    #162022
  );
  color: #6d8a76;
}
.art-ring {
  position: absolute;
  width: 195px;
  height: 195px;
  border: 1px solid #6281722e;
  border-radius: 50%;
  box-shadow:
    0 0 0 27px #72837108,
    0 0 0 65px #72837106;
}
.location-art > svg {
  position: relative;
}
.overview-scene {
  width: 100%;
  height: 145px;
  object-fit: cover;
  display: block;
  cursor: zoom-in;
}
.location-details {
  padding: 17px;
}
.eyebrow {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 10px;
  letter-spacing: 0.1em;
  color: var(--text-faint);
}
.location-details h2 {
  font-family: var(--serif);
  font-size: 23px;
  margin: 7px 0 9px;
  font-weight: 600;
}
.location-meta {
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: var(--text-dim);
}
.location-details p {
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.8;
  margin: 12px 0;
}
.overview-card {
  padding: 16px;
  border: 1px solid var(--line-soft);
  background: var(--ink-820);
  border-radius: 13px;
  flex-shrink: 0;
}
.card-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.card-heading h3 {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}
.card-heading h3 > svg {
  color: var(--text-dim);
}
.count {
  font-size: 11px;
  color: var(--text-faint);
}
.overview-clock {
  display: flex;
  gap: 12px;
  align-items: center;
  margin: 4px 0;
}
.overview-clock b {
  font-size: 12px;
  font-weight: 500;
}
.overview-clock small {
  display: block;
  color: var(--text-faint);
  font-size: 11px;
  margin-top: 4px;
}
.soft-empty {
  font-size: 12px;
  color: var(--text-dim);
  line-height: 1.8;
  padding-bottom: 8px;
}
.clue-preview {
  display: flex;
  gap: 9px;
  text-align: left;
  background: none;
  border: 0;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.75;
  padding: 4px 0;
  width: 100%;
}
.clue-dot {
  width: 5px;
  height: 5px;
  border: 1px solid var(--brass);
  margin-top: 8px;
  flex-shrink: 0;
}
.party-preview {
  display: flex;
  gap: 10px;
  align-items: center;
  width: 100%;
  border: 0;
  background: none;
  padding: 3px 0;
  color: var(--text);
  text-align: left;
}
.avatar-letter {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 9px;
  background: var(--ink-740);
  font-family: var(--serif);
  color: var(--brass);
}
.party-preview b {
  font-size: 12px;
  font-weight: 500;
}
.party-preview small {
  display: block;
  color: var(--text-faint);
  font-size: 11px;
  margin-top: 2px;
}
.pending-preview {
  display: flex;
  gap: 12px;
  padding: 16px;
  background: var(--brass-wash);
  border: 1px solid var(--brass-dim);
  border-radius: 12px;
  color: var(--ember);
  font-size: 12px;
}
.pending-preview p {
  margin: 4px 0;
  color: var(--text-dim);
}
@media (max-width: 1150px) {
  .overview-location .location-art {
    height: 96px;
  }
  .location-details {
    padding: 14px;
  }
}
</style>
