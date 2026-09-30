<script setup>
import { computed, onMounted, ref } from "vue";
import { darkTheme, dateZhCN, zhCN } from "naive-ui";

import TopBar from "./components/TopBar.vue";
import LeftSidebar from "./components/LeftSidebar.vue";
import StoryStream from "./components/StoryStream.vue";
import RightPanel from "./components/RightPanel.vue";
import SettingsModal from "./components/SettingsModal.vue";
import Lightbox from "./components/Lightbox.vue";

import { themeOverrides } from "./theme.js";
import { bootstrap, dismissToast, game, skipTyping } from "./store.js";

const booting = ref(true);
const bootError = ref("");

onMounted(async () => {
  try {
    await bootstrap();
  } catch (e) {
    bootError.value = e?.message ?? String(e);
  } finally {
    booting.value = false;
  }
});

const demoMode = computed(() => Boolean(game.echo));
</script>

<template>
  <!-- abstract：不渲染包装元素。默认会多出一层无高度的 div.n-config-provider，
       打断 html/body/#app 的 100% 高度链，.app-shell 会塌成内容高、被 overflow:hidden 裁掉。 -->
  <n-config-provider
    abstract
    :theme="darkTheme"
    :theme-overrides="themeOverrides"
    :locale="zhCN"
    :date-locale="dateZhCN"
  >
    <div class="app-shell">
      <TopBar />

      <div v-if="demoMode" class="demo-banner">
        <span class="dot" />
        <b>演示模式</b>
        <span class="sep">·</span>
        未配置 API Key，叙述由本地回声引擎生成，判定与状态结算照常走真实规则。
        <button class="link" @click="game.settingsOpen = true">去设置 →</button>
      </div>

      <main class="app-body">
        <LeftSidebar class="col-left" :class="{ collapsed: game.leftCollapsed }" />
        <StoryStream class="col-center" @skip="skipTyping" />
        <RightPanel class="col-right" :class="{ collapsed: game.rightCollapsed }" />
      </main>

      <!-- 全局浮层 -->
      <SettingsModal v-model:show="game.settingsOpen" />
      <Lightbox
        v-if="game.lightbox"
        :src="game.lightbox.url"
        :prompt="game.lightbox.prompt"
        @close="game.lightbox = null"
      />

      <div class="toast-stack">
        <div
          v-for="t in game.toasts"
          :key="t.id"
          class="toast"
          :class="`toast-${t.level}`"
          role="status"
          @click="dismissToast(t.id)"
        >
          {{ t.text }}
        </div>
      </div>

      <div v-if="booting" class="boot-mask">
        <div class="boot-inner">正在连接跑团台…</div>
      </div>
      <div v-else-if="bootError" class="boot-mask">
        <div class="boot-inner">
          <b>后端连接失败</b>
          <p>{{ bootError }}</p>
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
  background: radial-gradient(1200px 600px at 50% -10%, #16202c 0%, var(--ink-900) 60%);
  overflow: hidden;
}

.demo-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  font-size: 12.5px;
  color: #e6c98a;
  background: linear-gradient(90deg, rgba(212, 169, 74, 0.16), rgba(212, 169, 74, 0.04));
  border-bottom: 1px solid rgba(212, 169, 74, 0.25);
}
.demo-banner .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--brass);
  box-shadow: 0 0 8px var(--brass);
}
.demo-banner .sep {
  opacity: 0.5;
}
.demo-banner .link {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--brass);
  cursor: pointer;
  font: inherit;
  font-weight: 600;
}

.app-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 244px minmax(0, 1fr) 372px;
  gap: 0;
}
.app-body > * {
  min-width: 0;
  min-height: 0;
}

.col-left {
  border-right: 1px solid var(--line-soft);
  background: rgba(17, 21, 27, 0.7);
  overflow: hidden;
  transition: width 0.2s ease;
}
.col-right {
  border-left: 1px solid var(--line-soft);
  background: rgba(17, 21, 27, 0.7);
  overflow: hidden;
}

.toast-stack {
  position: fixed;
  right: 18px;
  bottom: 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 3000;
  max-width: 380px;
}
.toast {
  padding: 9px 13px;
  border-radius: 9px;
  font-size: 12.5px;
  line-height: 1.55;
  cursor: pointer;
  box-shadow: var(--shadow-lift);
  border: 1px solid var(--line);
  background: #1a2028;
  animation: toast-in 0.22s ease;
}
.toast-success { border-color: rgba(111, 169, 107, 0.5); color: #b6dbb1; }
.toast-warn { border-color: rgba(217, 139, 58, 0.5); color: #eec48c; }
.toast-error { border-color: rgba(194, 80, 76, 0.55); color: #e8a3a0; }

@keyframes toast-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: none; }
}

.boot-mask {
  position: fixed;
  inset: 0;
  background: rgba(9, 11, 14, 0.92);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 4000;
}
.boot-inner {
  text-align: center;
  color: var(--text-dim);
  font-size: 13px;
  line-height: 1.9;
}
.boot-inner p {
  max-width: 30rem;
  color: var(--text-faint);
}

@media (max-width: 1280px) {
  .app-body { grid-template-columns: 210px minmax(0, 1fr) 320px; }
}
</style>
