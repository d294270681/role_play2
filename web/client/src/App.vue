<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { darkTheme, dateZhCN, zhCN } from "naive-ui";
import TopBar from "./components/TopBar.vue";
import LeftSidebar from "./components/LeftSidebar.vue";
import StoryStream from "./components/StoryStream.vue";
import AdventureOverview from "./components/AdventureOverview.vue";
import ResourceStrip from "./components/ResourceStrip.vue";
import WorkspacePanel from "./components/WorkspacePanel.vue";
import SettingsModal from "./components/SettingsModal.vue";
import SessionManager from "./components/SessionManager.vue";
import Lightbox from "./components/Lightbox.vue";
import Icon from "./components/Icon.vue";
import { themeOverrides } from "./theme.js";
import {
  bootstrap,
  dismissToast,
  game,
  navigate,
  skipTyping,
} from "./store.js";
import { VIEWS, viewInfo } from "./ui.js";

const booting = ref(true),
  bootError = ref("");
const view = computed(() => viewInfo(game.view));
async function connect() {
  booting.value = true;
  bootError.value = "";
  try {
    await bootstrap();
    if (!game.config && !game.modules.length && game.lastError)
      bootError.value = game.lastError;
  } catch (e) {
    bootError.value = e?.message || String(e);
  } finally {
    booting.value = false;
  }
}
function onKey(event) {
  if (event.key === "Escape") game.mobileNav = false;
  if (
    !event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    game.settingsOpen ||
    game.sessionsOpen
  )
    return;
  const index = Number(event.key) - 1;
  if (index >= 0 && index < VIEWS.length) {
    event.preventDefault();
    navigate(VIEWS[index].key);
  }
}
onMounted(() => {
  void connect();
  window.addEventListener("keydown", onKey);
});
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <n-config-provider
    abstract
    :theme="darkTheme"
    :theme-overrides="themeOverrides"
    :locale="zhCN"
    :date-locale="dateZhCN"
  >
    <div
      class="app-shell"
      :class="{ 'nav-compact': game.leftCollapsed, 'nav-open': game.mobileNav }"
    >
      <a class="skip-link" href="#workspace">跳到工作区</a>
      <TopBar />
      <div class="app-body">
        <button
          v-if="game.mobileNav"
          class="nav-backdrop"
          aria-label="关闭导航"
          @click="game.mobileNav = false"
        ></button>
        <LeftSidebar />
        <main id="workspace" class="workspace" tabindex="-1">
          <div class="workspace-heading">
            <div>
              <div class="eyebrow">
                {{ game.loaded ? "旅程进行中" : "你的冒险工作台"
                }}<span v-if="game.loaded"> · 存档 {{ game.slot }}</span>
              </div>
              <h1>
                {{ view.label
                }}<span v-if="view.upcoming" class="tag subtle">准备阶段</span>
              </h1>
              <p>{{ view.caption }}</p>
            </div>
            <div class="workspace-actions">
              <span v-if="game.busy" class="sync-status" role="status"
                ><span class="status-dot working"></span
                >{{ game.turnStreaming ? "故事正在展开" : "同步存档中" }}</span
              >
              <button
                v-if="game.view === 'adventure'"
                class="secondary-button focus-button"
                :aria-pressed="game.rightCollapsed"
                @click="game.rightCollapsed = !game.rightCollapsed"
              >
                <Icon name="book" :size="15" />{{
                  game.rightCollapsed ? "显示状态摘要" : "专注阅读"
                }}
              </button>
              <button
                v-else
                class="secondary-button"
                @click="navigate('adventure')"
              >
                <Icon name="compass" :size="15" />返回冒险
              </button>
            </div>
          </div>
          <div v-if="game.echo" class="model-notice">
            <span class="status-dot"></span
            ><b>{{
              game.config?.llm_mode === "demo" ? "演示模式" : "文字模型未配置"
            }}</b
            ><span>当前使用示例叙述，判定与存档正常。</span
            ><button class="text-button" @click="game.settingsOpen = true">
              配置模型<Icon name="arrow" :size="14" />
            </button>
          </div>
          <ResourceStrip />
          <div class="workspace-content">
            <div
              v-show="game.view === 'adventure'"
              class="adventure-columns"
              :class="{ focused: game.rightCollapsed }"
            >
              <StoryStream @skip="skipTyping" />
              <AdventureOverview v-if="!game.rightCollapsed && game.loaded" />
            </div>
            <WorkspacePanel v-if="game.view !== 'adventure'" />
          </div>
        </main>
      </div>
      <SettingsModal v-model:show="game.settingsOpen" />
      <SessionManager />
      <Lightbox
        v-if="game.lightbox"
        :src="game.lightbox.url"
        :prompt="game.lightbox.prompt"
        @close="game.lightbox = null"
      />
      <div class="toast-stack" aria-live="polite">
        <button
          v-for="toast in game.toasts"
          :key="toast.id"
          class="toast"
          :class="'toast-' + toast.level"
          @click="dismissToast(toast.id)"
        >
          <Icon
            :name="toast.level === 'success' ? 'check' : 'activity'"
            :size="16"
          /><span>{{ toast.text }}</span
          ><Icon name="close" :size="12" />
        </button>
      </div>
      <div v-if="booting || bootError" class="boot-mask">
        <div class="boot-inner">
          <Icon name="compass" :size="38" />
          <h2>{{ bootError ? "暂时无法连接游戏" : "正在展开你的旅程" }}</h2>
          <p>{{ bootError || "读取冒险本与存档…" }}</p>
          <button v-if="bootError" class="primary-button" @click="connect">
            重新连接
          </button>
        </div>
      </div>
    </div>
  </n-config-provider>
</template>

<style scoped>
.app-shell {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--ink-900);
}
.app-body {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  flex: 1;
  min-height: 0;
}
.nav-compact .app-body {
  grid-template-columns: 74px minmax(0, 1fr);
}
.workspace {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 24px 28px 22px;
  min-width: 0;
  min-height: 0;
  outline: none;
}
.workspace-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-shrink: 0;
}
.eyebrow {
  font-size: 11px;
  color: var(--text-faint);
  letter-spacing: 0.08em;
}
h1 {
  font-size: 27px;
  line-height: 1.4;
  letter-spacing: -0.02em;
  margin: 4px 0;
  font-weight: 650;
  display: flex;
  align-items: center;
  gap: 12px;
}
.workspace-heading p {
  font-size: 12px;
  color: var(--text-dim);
  margin: 0;
}
.workspace-actions {
  display: flex;
  align-items: center;
  gap: 14px;
}
.sync-status {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  color: var(--brass);
  white-space: nowrap;
}
.model-notice {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 12px;
  padding: 9px 13px;
  color: var(--text-dim);
  background: var(--brass-wash);
  border: 1px solid #bfa26430;
  border-radius: 9px;
}
.model-notice b {
  font-weight: 500;
  color: var(--brass);
}
.model-notice > .text-button {
  margin-left: auto;
  white-space: nowrap;
}
.workspace-content {
  flex: 1;
  min-height: 0;
  min-width: 0;
}
.adventure-columns {
  height: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 20px;
}
.adventure-columns.focused,
.adventure-columns:not(:has(.overview)) {
  grid-template-columns: minmax(0, 1fr);
}
.toast-stack {
  position: fixed;
  right: 24px;
  bottom: 22px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: min(420px, calc(100vw - 32px));
  z-index: 4000;
}
.toast {
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
  border: 1px solid var(--line-bright);
  background: var(--ink-740);
  color: var(--text);
  padding: 12px 14px;
  border-radius: 10px;
  box-shadow: var(--shadow-lift);
  font-size: 12px;
}
.toast > span {
  flex: 1;
}
.toast-success > svg:first-child {
  color: var(--moss);
}
.toast-warn {
  border-color: #dfad6550;
}
.toast-error {
  border-color: #df8a8050;
}
.toast-error > svg:first-child {
  color: var(--blood);
}
.boot-mask {
  position: fixed;
  inset: 0;
  background: #0c1215f5;
  display: grid;
  place-items: center;
  z-index: 5000;
  padding: 24px;
}
.boot-inner {
  max-width: 500px;
  text-align: center;
}
.boot-inner > svg {
  color: var(--brass);
}
.boot-inner h2 {
  font-size: 20px;
}
.boot-inner p {
  color: var(--text-dim);
  font-size: 13px;
  line-height: 1.9;
}
.boot-inner > .primary-button {
  margin: 18px auto 0;
}
.nav-backdrop {
  display: none;
}
@media (min-width: 1700px) {
  .workspace {
    padding: 28px 38px;
  }
  .adventure-columns {
    grid-template-columns: minmax(0, 1fr) 340px;
    gap: 24px;
  }
}
@media (max-width: 1200px) {
  .app-body {
    grid-template-columns: 194px minmax(0, 1fr);
  }
  .workspace {
    padding: 20px;
    gap: 16px;
  }
  .adventure-columns {
    grid-template-columns: minmax(0, 1fr) 270px;
    gap: 14px;
  }
}
@media (max-width: 1000px) {
  .app-body,
  .nav-compact .app-body {
    grid-template-columns: 1fr;
  }
  .adventure-columns {
    grid-template-columns: 1fr;
  }
  .adventure-columns > .overview {
    display: none;
  }
  .focus-button {
    display: none;
  }
  .nav-backdrop {
    display: block;
    position: fixed;
    inset: 64px 0 0;
    z-index: 90;
    background: #0009;
    border: 0;
  }
  .workspace {
    padding: 18px 22px;
  }
}
@media (max-width: 650px) {
  .workspace {
    padding: 16px 12px 12px;
    gap: 12px;
  }
  h1 {
    font-size: 23px;
  }
  .workspace-heading p {
    font-size: 11px;
  }
  .workspace-actions > .sync-status {
    display: none;
  }
  .workspace-actions > .secondary-button {
    font-size: 11px;
    padding: 8px;
  }
  .model-notice {
    flex-wrap: wrap;
    font-size: 11px;
    gap: 7px;
  }
  .model-notice > span:not(.status-dot) {
    display: none;
  }
  .toast-stack {
    right: 12px;
    bottom: 12px;
  }
}
</style>
