/**
 * Naive UI 暗色跑团主题覆盖：主色换成黄铜金，面板/弹窗/输入框压到墨蓝炭黑。
 * 由 App.vue 的 <n-config-provider :theme-overrides="themeOverrides"> 注入
 * （NConfigProvider 没有 install，必须以组件形式使用，不能 app.use）。
 */
export const themeOverrides = {
  common: {
    primaryColor: "#e2b563",
    primaryColorHover: "#f0c57a",
    primaryColorPressed: "#c29950",
    primaryColorSuppl: "#e2b563",
    infoColor: "#7ba5c1",
    successColor: "#80b394",
    warningColor: "#dfad65",
    errorColor: "#df8a80",
    bodyColor: "#0c1215",
    cardColor: "#141e23",
    modalColor: "#141e23",
    popoverColor: "#1e2b31",
    tableColor: "#141e23",
    inputColor: "#0c1215",
    borderColor: "#29383e",
    dividerColor: "#29383e",
    textColorBase: "#e2e8e6",
    textColor1: "#e2e8e6",
    textColor2: "#bcc9c6",
    textColor3: "#a4b2b3",
    borderRadius: "8px",
    fontFamily:
      '"PingFang SC","Microsoft YaHei","Noto Sans SC",system-ui,-apple-system,"Segoe UI",sans-serif',
  },
  Card: { borderRadius: "14px" },
  Modal: { color: "#141e23", borderRadius: "14px" },
  Drawer: { color: "#10181c" },
  TabPane: { tabFontWeightActive: "600" },
  Tabs: { tabFontSizeMedium: "13px" },
};

export default themeOverrides;
