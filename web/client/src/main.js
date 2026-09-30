import { createApp } from "vue";
import {
  NButton,
  NConfigProvider,
  NInput,
  NInputNumber,
  NModal,
  NSelect,
  NSpace,
  NSwitch,
  NTabPane,
  NTabs,
  NTag,
} from "naive-ui";

import App from "./App.vue";
import "./styles.css";

/** 只注册模板里真正用到的组件，避免整包引入。 */
const naive = {
  NButton, NConfigProvider, NInput, NInputNumber, NModal,
  NSelect, NSpace, NSwitch, NTabPane, NTabs, NTag,
};

// 暗色主题 / 中文 locale 由 App.vue 根节点的 <n-config-provider> 提供——
// NConfigProvider 没有 install 方法，app.use(NConfigProvider, …) 是静默无效的。
const app = createApp(App);
for (const [name, comp] of Object.entries(naive)) app.component(name, comp);
app.mount("#app");
