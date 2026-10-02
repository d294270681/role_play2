<script setup>
import { computed } from "vue";
import Icon from "./Icon.vue";
import { abortTurn, game } from "../store.js";
import { currentPeriod, isNight } from "../util.js";
const title = computed(
  () =>
    game.moduleInfo?.title ||
    game.modules.find((module) => module.dir === game.module)?.title ||
    "文字冒险",
);
const period = computed(() => currentPeriod(game.state));
</script>
<template>
  <header class="topbar">
    <div class="brand">
      <span class="brand-mark"><Icon name="compass" :size="25" /></span
      ><span><b>冒险工作台</b><small>故事，由你继续。</small></span>
    </div>
    <button
      class="icon-button mobile-menu"
      aria-label="打开功能导航"
      :aria-expanded="game.mobileNav"
      @click="game.mobileNav = !game.mobileNav"
    >
      <Icon name="menu" />
    </button>
    <button
      class="campaign-name"
      title="选择冒险本或切换存档"
      @click="game.sessionsOpen = true"
    >
      <span class="campaign-dot"></span>{{ title
      }}<Icon name="chevron" :size="13" />
    </button>
    <div v-if="game.loaded" class="world-stamp">
      <span
        ><Icon :name="isNight(period) ? 'moon' : 'sun'" :size="15" />第
        {{ game.state.day }} 天 · {{ period }}</span
      ><span><Icon name="pin" :size="15" />{{ game.state.location }}</span>
    </div>
    <div class="top-actions">
      <button v-if="game.turnStreaming" class="stream-stop" @click="abortTurn">
        停止显示
      </button>
      <button
        class="model-btn"
        :title="
          game.config?.configured ? game.config.base_url : '配置文字大模型 API'
        "
        @click="game.settingsOpen = true"
      >
        <span
          class="status-dot"
          :class="{ ready: game.config?.configured }"
        ></span
        ><span>{{
          game.config?.configured
            ? game.config.model
            : game.config?.llm_mode === "demo"
              ? "演示模式"
              : "配置大模型 API"
        }}</span>
      </button>
      <button
        class="icon-button settings-btn"
        title="设置"
        aria-label="设置"
        @click="game.settingsOpen = true"
      >
        <Icon name="settings" :size="19" />
      </button>
    </div>
  </header>
</template>
<style scoped>
.topbar {
  height: 72px;
  display: flex;
  align-items: center;
  gap: 26px;
  padding: 0 26px 0 24px;
  border-bottom: 1px solid var(--line-soft);
  background: var(--ink-860);
  flex-shrink: 0;
}
.brand {
  display: flex;
  align-items: center;
  gap: 11px;
  width: 170px;
  flex-shrink: 0;
}
.brand-mark {
  width: 38px;
  height: 38px;
  border: 1px solid var(--brass-dim);
  color: var(--brass);
  border-radius: 11px;
  background: var(--brass-wash);
  display: grid;
  place-items: center;
}
.brand b {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.05em;
}
.brand small {
  display: block;
  font-size: 9px;
  color: var(--text-faint);
  letter-spacing: 0.08em;
  margin-top: 2px;
}
.campaign-name {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
  border: 0;
  background: none;
  color: var(--text);
  padding: 7px 0;
  white-space: nowrap;
}
.campaign-name > svg {
  color: var(--text-faint);
}
.campaign-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--brass);
}
.world-stamp {
  display: flex;
  align-items: center;
  gap: 20px;
  color: var(--text-dim);
  font-size: 12px;
}
.world-stamp > span {
  display: flex;
  gap: 7px;
  align-items: center;
  white-space: nowrap;
}
.world-stamp svg {
  color: var(--text-faint);
}
.top-actions {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-left: auto;
}
.model-btn {
  display: flex;
  gap: 8px;
  align-items: center;
  max-width: 190px;
  border: 1px solid var(--line);
  background: var(--ink-820);
  padding: 7px 11px;
  color: var(--text-dim);
  border-radius: 8px;
  font-size: 11px;
}
.model-btn > span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.settings-btn {
  border-left: 1px solid var(--line);
  border-radius: 0;
  padding-left: 14px;
}
.mobile-menu {
  display: none;
}
.stream-stop {
  background: none;
  border: 1px solid #de8e8060;
  color: var(--blood);
  font-size: 11px;
  border-radius: 7px;
  padding: 6px 9px;
}
@media (max-width: 1200px) {
  .topbar {
    gap: 18px;
  }
  .world-stamp {
    gap: 12px;
  }
  .brand {
    width: 146px;
  }
}
@media (max-width: 1000px) {
  .topbar {
    height: 64px;
    padding: 0 20px;
    gap: 16px;
  }
  .brand {
    width: auto;
  }
  .brand small {
    display: none;
  }
  .mobile-menu {
    display: flex;
    order: -1;
  }
  .brand-mark {
    width: 32px;
    height: 32px;
  }
  .brand b {
    font-size: 13px;
  }
  .world-stamp {
    display: none;
  }
}
@media (max-width: 650px) {
  .topbar {
    gap: 11px;
    padding: 0 12px;
  }
  .brand {
    display: none;
  }
  .campaign-name {
    font-size: 12px;
    max-width: 145px;
    overflow: hidden;
  }
  .top-actions {
    gap: 7px;
  }
  .model-btn {
    max-width: 136px;
    padding: 6px 8px;
    font-size: 10px;
  }
  .stream-stop {
    display: none;
  }
  .settings-btn {
    padding-left: 9px;
  }
}
</style>
