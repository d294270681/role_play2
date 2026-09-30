import { createApp } from "vue";
import {
  darkTheme,
  NAlert,
  NBadge,
  NButton,
  NCard,
  NCheckbox,
  NConfigProvider,
  NDialogProvider,
  NDrawer,
  NDrawerContent,
  NEmpty,
  NInput,
  NInputNumber,
  NMessageProvider,
  NModal,
  NPopconfirm,
  NProgress,
  NSelect,
  NSpace,
  NSpin,
  NSwitch,
  NTabPane,
  NTabs,
  NTag,
  NTooltip,
  zhCN,
  dateZhCN,
} from "naive-ui";

import App from "./App.vue";
import "./styles.css";

/** 只注册真正用到的组件，避免整包引入。 */
const naive = {
  NAlert, NBadge, NButton, NCard, NCheckbox, NDialogProvider, NDrawer, NDrawerContent,
  NEmpty, NInput, NInputNumber, NMessageProvider, NModal, NPopconfirm, NProgress,
  NSelect, NSpace, NSpin, NSwitch, NTabPane, NTabs, NTag, NTooltip,
};

/** 暗色跑团主题：把 naive 的主色换成黄铜金。 */
const themeOverrides = {
  common: {
    primaryColor: "#d4a94a",
    primaryColorHover: "#e0bb63",
    primaryColorPressed: "#b8913a",
    primaryColorSuppl: "#d4a94a",
    infoColor: "#5f95d8",
    successColor: "#6fa96b",
    warningColor: "#d98b3a",
    errorColor: "#c2504c",
    bodyColor: "#0d1014",
    cardColor: "#151a21",
    modalColor: "#151a21",
    popoverColor: "#1a2028",
    tableColor: "#151a21",
    inputColor: "#10141a",
    borderColor: "#2a323e",
    dividerColor: "#2a323e",
    textColorBase: "#d9dfe8",
    textColor1: "#d9dfe8",
    textColor2: "#aab4c2",
    textColor3: "#8c98a9",
    borderRadius: "8px",
    fontFamily: '"PingFang SC","Microsoft YaHei","Noto Sans SC",system-ui,-apple-system,"Segoe UI",sans-serif',
  },
  Card: { borderRadius: "10px" },
  Modal: { color: "#151a21", borderRadius: "12px" },
  Drawer: { color: "#11151b" },
  TabPane: { tabFontWeightActive: "600" },
  Tabs: { tabFontSizeMedium: "13px" },
};

const app = createApp(App);
app.use(NConfigProvider, { theme: darkTheme, themeOverrides, locale: zhCN, dateLocale: dateZhCN });
for (const [name, comp] of Object.entries(naive)) app.component(name, comp);
app.mount("#app");
