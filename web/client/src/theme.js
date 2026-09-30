/**
 * Naive UI 暗色跑团主题覆盖：主色换成黄铜金，面板/弹窗/输入框压到墨蓝炭黑。
 * 由 App.vue 的 <n-config-provider :theme-overrides="themeOverrides"> 注入
 * （NConfigProvider 没有 install，必须以组件形式使用，不能 app.use）。
 */
export const themeOverrides = {
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

export default themeOverrides;
