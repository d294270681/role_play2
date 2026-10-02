<script setup>
import { computed } from "vue";
import Icon from "./Icon.vue";
import { game, navigate } from "../store.js";
import { VIEWS } from "../ui.js";
const counts = computed(() => ({
  items: game.state?.inventory?.length,
  clocks: game.state?.clocks?.length,
  relations: game.state?.relations?.length,
  clues: game.state?.clues?.filter((clue) => !clue.done).length,
  events:
    (game.state?.events_fired?.length || 0) +
    (game.state?.pending_event ? 1 : 0),
}));
</script>
<template>
  <aside class="sidebar">
    <div class="nav-caption">
      <span>探索与记录</span
      ><button
        class="icon-button collapse-nav"
        :title="game.leftCollapsed ? '展开导航' : '收起导航'"
        @click="game.leftCollapsed = !game.leftCollapsed"
      >
        <Icon name="menu" :size="15" /></button
      ><button
        class="icon-button close-nav"
        aria-label="关闭功能导航"
        @click="game.mobileNav = false"
      >
        <Icon name="close" :size="18" />
      </button>
    </div>
    <nav aria-label="游戏功能">
      <button
        v-for="(view, index) in VIEWS"
        :key="view.key"
        class="nav-item"
        :class="{ active: game.view === view.key, upcoming: view.upcoming }"
        :title="view.label + ' · Alt+' + (index + 1)"
        :aria-label="view.label"
        :aria-current="game.view === view.key ? 'page' : undefined"
        @click="navigate(view.key)"
      >
        <Icon :name="view.icon" :size="19" /><span class="nav-label">{{
          view.label
        }}</span
        ><small v-if="view.upcoming" class="nav-badge">预备</small
        ><span
          v-else-if="counts[view.key] !== undefined && game.loaded"
          class="nav-count"
          >{{ counts[view.key] }}</span
        ><span v-if="game.view === view.key" class="nav-active-dot"></span>
      </button>
    </nav>
    <div class="sidebar-bottom">
      <div
        class="session-summary"
        :title="game.loaded ? '当前存档 ' + game.slot : '管理冒险本与存档'"
      >
        <div class="session-icon"><Icon name="save" :size="18" /></div>
        <span
          ><b>{{
            game.loaded
              ? "存档 " + String(game.slot).padStart(2, "0")
              : "还未开启冒险"
          }}</b
          ><small>{{
            game.busy
              ? "正在同步…"
              : game.loaded
                ? "行动完成后自动保存"
                : "选择冒险本与角色"
          }}</small></span
        >
      </div>
      <button
        class="session-button"
        title="冒险与存档"
        @click="game.sessionsOpen = true"
      >
        <Icon name="book" :size="17" /><span>冒险与存档</span
        ><Icon name="chevron" :size="14" />
      </button>
      <button
        class="settings-link"
        title="模型与界面设置"
        @click="game.settingsOpen = true"
      >
        <Icon name="settings" :size="16" /><span>模型与界面设置</span>
      </button>
      <div class="sidebar-note">
        <span class="status-dot ready"></span>文字冒险 · 自由探索
      </div>
    </div>
  </aside>
</template>
<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 25px 14px 18px;
  background: var(--ink-860);
  border-right: 1px solid var(--line-soft);
  min-height: 0;
  overflow-y: auto;
}
.nav-caption {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 12px;
  color: var(--text-faint);
  font-size: 10px;
  letter-spacing: 0.1em;
}
.close-nav {
  display: none;
}
nav {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.nav-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  border: 1px solid transparent;
  background: none;
  border-radius: 9px;
  padding: 12px;
  color: var(--text-dim);
  font-size: 12px;
  position: relative;
  text-align: left;
  min-height: 45px;
}
.nav-item:hover {
  color: var(--text);
  background: var(--ink-820);
}
.nav-item.active {
  background: var(--brass-wash);
  color: var(--brass);
  border-color: #c49c4a24;
}
.nav-label {
  flex: 1;
  white-space: nowrap;
}
.nav-count {
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: var(--text-faint);
  min-width: 18px;
  text-align: center;
  background: var(--ink-740);
  border-radius: 5px;
  padding: 1px 3px;
}
.nav-item.active .nav-count {
  background: #bca56818;
  color: var(--brass);
}
.nav-badge {
  font-size: 9px;
  border: 1px solid var(--line);
  border-radius: 4px;
  color: var(--text-faint);
  padding: 0 4px;
}
.nav-item.upcoming {
  margin-top: 12px;
  border-top: 1px solid var(--line-soft);
  border-radius: 0 0 9px 9px;
}
.nav-active-dot {
  position: absolute;
  left: -14px;
  top: 13px;
  bottom: 13px;
  width: 3px;
  background: var(--brass);
  border-radius: 0 3px 3px 0;
}
.sidebar-bottom {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 24px;
}
.session-summary {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 10px 8px;
}
.session-icon {
  width: 33px;
  height: 33px;
  display: grid;
  place-items: center;
  background: var(--ink-740);
  border: 1px solid var(--line);
  border-radius: 9px;
  color: var(--text-dim);
}
.session-summary b {
  font-size: 11px;
  font-weight: 500;
}
.session-summary small {
  display: block;
  font-size: 10px;
  color: var(--text-faint);
  margin-top: 3px;
}
.session-button {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 11px 12px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--ink-820);
  color: var(--text);
  font-size: 11px;
}
.session-button > span {
  flex: 1;
  text-align: left;
}
.session-button > svg:last-child {
  color: var(--text-faint);
}
.settings-link {
  display: flex;
  gap: 9px;
  align-items: center;
  padding: 8px 12px;
  background: none;
  border: 0;
  color: var(--text-dim);
  font-size: 11px;
}
.sidebar-note {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 12px;
  color: var(--text-faint);
  font-size: 9px;
}
.nav-compact .sidebar {
  padding: 24px 10px 18px;
}
.nav-compact .nav-caption {
  padding: 0;
  justify-content: center;
}
.nav-compact .nav-caption > span,
.nav-compact .nav-label,
.nav-compact .nav-count,
.nav-compact .nav-badge,
.nav-compact .sidebar-bottom span,
.nav-compact .sidebar-bottom small,
.nav-compact .sidebar-note,
.nav-compact .session-summary {
  display: none;
}
.nav-compact .nav-item {
  justify-content: center;
  padding: 13px 0;
}
.nav-compact .session-button,
.nav-compact .settings-link {
  justify-content: center;
  padding: 12px 0;
}
.nav-compact .session-button > svg:last-child {
  display: none;
}
@media (max-width: 1000px) {
  .sidebar,
  .nav-compact .sidebar {
    position: fixed;
    top: 64px;
    bottom: 0;
    left: 0;
    width: 250px;
    z-index: 100;
    transform: translateX(-100%);
    transition: transform 0.22s ease;
    padding: 22px 14px 18px;
    box-shadow: var(--shadow-lift);
  }
  .nav-open .sidebar {
    transform: translateX(0);
  }
  .collapse-nav {
    display: none;
  }
  .close-nav {
    display: flex;
  }
  .nav-compact .nav-caption {
    justify-content: space-between;
    padding: 0 12px;
  }
  .nav-compact .nav-caption > span,
  .nav-compact .nav-label {
    display: block;
  }
  .nav-compact .nav-item {
    justify-content: flex-start;
    padding: 12px;
  }
  .nav-compact .sidebar-bottom span,
  .nav-compact .sidebar-bottom small {
    display: block;
  }
  .nav-compact .session-summary,
  .nav-compact .sidebar-note {
    display: flex;
  }
  .nav-compact .session-button,
  .nav-compact .settings-link {
    justify-content: flex-start;
    padding: 11px 12px;
  }
  .nav-compact .nav-count,
  .nav-compact .nav-badge {
    display: block;
  }
}
</style>
