<script setup>
import { computed, ref, watch } from "vue";

import { cancelImageSetup, checkImageEnvironment, controlImageRuntime, disableImage, game, loadConfig, loadImageStatus, saveConfig, setupImage } from "../store.js";
import api from "../api.js";
import { modelForm, modelPatch } from "../modelConfig.js";

const props = defineProps({ show: { type: Boolean, default: false } });
const emit = defineEmits(["update:show"]);

const form = ref({ ...modelForm(), image_profile: "z-image-turbo" });
const saving = ref(false);
const busyProbe = ref(false);
const wantLocal = ref(false);
const probingModel = ref(false);
const modelProbe = ref(null);
let probeRevision = 0;
watch(() => [form.value.llm_mode, form.value.api_auth, form.value.base_url, form.value.model, form.value.api_key, form.value.clear_api_key, form.value.temperature, form.value.timeout, form.value.stream], () => { probeRevision += 1; modelProbe.value = null; });

watch(
  () => props.show,
  async (open) => {
    if (!open) return;
    const cfg = await loadConfig();
    if (!cfg) return;
    form.value = {
      ...modelForm(cfg),
      image_profile: cfg.image_generation?.profile || "z-image-turbo",
    };
    await loadImageStatus();
    wantLocal.value = cfg.image_generation?.enabled === true || game.imageSetup?.active === true;
    if (game.imageSetup?.active && game.imageSetup.profile) form.value.image_profile = game.imageSetup.profile;
  },
);

const keyHint = computed(() => {
  const cfg = game.config;
  if (!cfg?.has_api_key) return "未保存密钥";
  return cfg.api_key_tail ? `已配置 · 尾号 ${cfg.api_key_tail}` : "已配置";
});

async function submit() {
  saving.value = true;
  try {
    const cfg = await saveConfig(modelPatch(form.value, game.config));
    if (cfg) Object.assign(form.value, modelForm(cfg));
  } finally { saving.value = false; }
}

async function testModel() {
  probingModel.value = true;
  const revision = probeRevision;
  try {
    const result = await api.testModelConfig(modelPatch(form.value, game.config));
    if (revision === probeRevision) modelProbe.value = { ok: true, message: result.message };
  } catch (e) { if (revision === probeRevision) modelProbe.value = { ok: false, message: e.message }; }
  finally { probingModel.value = false; }
}

const imageOptions = computed(() => (game.comfy?.profiles || []).map((p) => ({
  label: p.title + (p.available ? "（已有本地文件）" : ""), value: p.id,
})));
const selected = computed(() => game.comfy?.profiles?.find((p) => p.id === form.value.image_profile));
const configuredTitle = computed(() => game.comfy?.profiles?.find((p) => p.id === game.comfy?.profile)?.title || "");
const job = computed(() => game.imageSetup || {});
const report = computed(() => game.imageEnvironment?.profile === form.value.image_profile ? game.imageEnvironment : null);
const jobForSelection = computed(() => job.value.profile === form.value.image_profile);
const download = computed(() => jobForSelection.value ? job.value.download : null);
const percent = computed(() => download.value?.total ? Math.min(100, Math.round(download.value.received / download.value.total * 100)) : 0);
const size = (bytes) => `${(Number(bytes || 0) / 1024 ** 3).toFixed(2)} GiB`;

async function probe() {
  busyProbe.value = true;
  try { await checkImageEnvironment(form.value.image_profile); } finally { busyProbe.value = false; }
}

async function configure() {
  busyProbe.value = true;
  try { await setupImage(form.value.image_profile); } finally { busyProbe.value = false; }
}

async function toggleLocal(value) {
  wantLocal.value = value;
  if (value) return;
  busyProbe.value = true;
  try { if (!(await disableImage())) wantLocal.value = true; } finally { busyProbe.value = false; }
}

async function cancelSetup() {
  busyProbe.value = true;
  try { await cancelImageSetup(); } finally { busyProbe.value = false; }
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    title="设置"
    style="max-width: 720px"
    :bordered="false"
    @update:show="emit('update:show', $event)"
  >
    <div class="settings">
      <section>
        <h4 class="section-label">文字大模型</h4>
        <div class="status-row">
          <n-tag :type="game.config?.configured ? 'success' : 'warning'" size="small" round>{{ game.config?.configured ? `当前模型：${game.config.model}` : game.config?.llm_mode === 'demo' ? '当前使用演示模式' : '文字模型尚未配置' }}</n-tag>
          <a class="guide-link" href="/guide" target="_blank" rel="noopener">环境配置指引 ↗</a>
        </div>

        <label class="lbl">接入方式</label>
        <n-select v-model:value="form.llm_mode" :disabled="saving || probingModel" :options="[{label:'通用模型 API（OpenAI 兼容）',value:'api'},{label:'Kimi Code 登录（可选）',value:'kimi-oauth'},{label:'演示模式（不连接大模型）',value:'demo'}]" />
        <template v-if="form.llm_mode === 'api'">
          <p class="hint">填写你选择的模型服务。支持云端 API、兼容网关或本地模型服务，模型 ID 由服务商提供。</p>
          <label class="lbl" for="llm-api-url">API 基础地址</label>
          <n-input v-model:value="form.base_url" :input-props="{id:'llm-api-url'}" placeholder="https://你的模型服务地址/v1" :disabled="saving || probingModel" />
          <label class="lbl" for="llm-model-id">模型 ID</label>
          <n-input v-model:value="form.model" :input-props="{id:'llm-model-id'}" placeholder="服务商提供的模型 ID" :disabled="saving || probingModel" />
          <label class="lbl">API 认证</label>
          <n-select v-model:value="form.api_auth" :disabled="saving || probingModel" :options="[{label:'API Key（Bearer）',value:'bearer'},{label:'无需密钥（例如本地服务）',value:'none'}]" />
          <template v-if="form.api_auth === 'bearer'">
            <label class="lbl" for="llm-api-key">API Key · {{ keyHint }}</label>
            <n-input v-model:value="form.api_key" :input-props="{id:'llm-api-key',autocomplete:'off'}" type="password" show-password-on="click" placeholder="填写 API Key；同一接口留空可保留已存密钥" :disabled="form.clear_api_key || saving || probingModel" />
            <n-checkbox v-if="game.config?.has_api_key" v-model:checked="form.clear_api_key" class="clear-key" :disabled="saving || probingModel">保存时清除已有密钥</n-checkbox>
            <p class="hint">更换接口地址或接入方式时，旧密钥会清除，需要填写新服务的密钥。</p>
          </template>
        </template>
        <p v-else-if="form.llm_mode === 'kimi-oauth'" class="hint">
          仅在选择此方式后使用本机 Kimi Code 登录。{{ game.config?.kimi_credentials_available ? '已找到登录凭证。' : '选择后保存，若未登录请先登录 Kimi Code；也可选择通用 API 填写密钥。' }}不需要填写 API Key，登录凭证只用于 Kimi 接口。
        </p>
        <p v-else class="hint">演示模式使用本地示例叙述，判定和存档功能可正常使用。随时可以回来配置真实模型 API。</p>
        <template v-if="form.llm_mode !== 'demo'">
          <div class="grid2">
            <div>
              <label class="lbl">temperature（{{ form.llm_mode === 'kimi-oauth' ? '1.00' : Number(form.temperature).toFixed(2) }}）</label>
              <input v-model.number="form.temperature" class="slider" type="range" min="0" max="2" step="0.05" :disabled="form.llm_mode === 'kimi-oauth' || saving || probingModel" />
            </div>
            <div><label class="lbl">超时（秒）</label><n-input-number v-model:value="form.timeout" :min="5" :max="900" :disabled="saving || probingModel" style="width:100%" /></div>
          </div>
          <label class="row"><n-switch v-model:value="form.stream" :disabled="saving || probingModel" /><span>流式输出（关闭则等待完整回复）</span></label>
          <div class="actions"><n-button :loading="probingModel" :disabled="saving || game.busy" @click="testModel">测试连接</n-button></div>
          <p class="hint">测试会发送一条短请求，按服务商计费，最多等待 30 秒。使用当前填写的值，不会保存配置。</p>
          <p v-if="modelProbe" class="probe-result" :class="{failed:!modelProbe.ok}">{{ modelProbe.message }}</p>
        </template>
        <p class="hint">点击「保存配置」后写入 web/config.json，下个回合使用新配置，重启后自动恢复。</p>
      </section>

      <section>
        <h4 class="section-label">图片生成（可选）</h4>
        <label class="row">
          <n-switch :value="wantLocal" :loading="busyProbe" @update:value="toggleLocal" />
          <span>配置本地图片生成</span>
        </label>
        <p class="hint">默认关闭。未完成配置时不启动生图环境、不加载模型。配置成功后，生成剧情插图、地点图或头像时才加载模型。</p>
        <div class="status-row">
          <n-tag :type="game.comfy?.available ? 'success' : 'default'" size="small" round>
            {{ job.active ? '配置中' : game.comfy?.ready ? '可出图 · 服务运行中' : game.comfy?.available ? '已配置 · 按需加载' : wantLocal ? '待配置 · 尚未启用' : '图片生成已关闭' }}
          </n-tag>
          <span v-if="game.comfy?.available" class="dim">{{ configuredTitle }}</span>
          <n-button v-if="game.comfy?.managed" size="tiny" quaternary @click="controlImageRuntime('stop')">释放生图占用</n-button>
        </div>
        <template v-if="wantLocal">
          <label class="lbl">选择出图模型</label>
          <n-select v-model:value="form.image_profile" :options="imageOptions" :disabled="job.active || busyProbe" />
          <p class="hint">{{ selected?.description }}</p>
          <p v-if="selected?.requirements" class="hint">
            当前配方门槛：NVIDIA 显存 {{ selected.requirements.vram_gib }} GiB，内存 {{ selected.requirements.ram_gib }} GiB，CPU {{ selected.requirements.cpu_threads }} 线程。自动安装支持 Windows x64。
          </p>
          <div class="actions">
            <n-button type="primary" :loading="busyProbe || job.active" :disabled="job.active || game.busy" @click="configure">检测并配置</n-button>
            <n-button :disabled="job.active || busyProbe" @click="probe">只检查环境</n-button>
            <n-button v-if="job.active" :disabled="busyProbe" @click="cancelSetup">取消安装</n-button>
          </div>
          <p class="hint">点击「检测并配置」后会先检查环境，符合门槛则自动下载所需文件并配置。已有文件会校验后复用；未完成的下载可续传。</p>

          <div v-if="report" class="environment" aria-live="polite">
            <n-tag :type="report.eligible ? 'success' : 'warning'" size="small">{{ report.eligible ? '环境符合安装门槛' : '环境未达标' }}</n-tag>
            <table class="hardware-table">
              <thead><tr><th>检查项</th><th>本机情况</th><th>要求</th></tr></thead>
              <tbody>
                <tr v-for="check in report.checks" :key="check.id" :class="{ failed: !check.passed }">
                  <td>{{ check.passed ? '✓' : '✕' }} {{ check.title }}</td>
                  <td>{{ check.actual }}<span v-if="!check.passed" class="reason">{{ check.reason }}</span></td>
                  <td>{{ check.required }}</td>
                </tr>
              </tbody>
            </table>
            <p class="hint">需下载约 {{ size(report.download_bytes) }} 的模型文件{{ game.comfy?.installed ? '，运行环境已存在。' : '，另需下载运行环境与依赖。' }}</p>
            <p v-for="warning in report.warnings" :key="warning" class="hint">{{ warning }}</p>
            <p v-if="!report.eligible" class="api-advice">{{ report.recommendation }}</p>
          </div>

          <div v-if="jobForSelection && job.status !== 'idle'" class="install-progress" aria-live="polite">
            <strong>{{ job.message }}</strong>
            <template v-if="download">
              <p>{{ download.stage === 'verifying' ? '校验文件' : download.stage === 'reused' ? '复用文件' : '下载文件' }}：{{ download.file }}</p>
              <n-progress type="line" :percentage="percent" :show-indicator="true" />
              <p class="hint">当前文件 {{ size(download.received) }} / {{ size(download.total) }}</p>
            </template>
            <p v-if="job.active && job.phase === 'dependencies'" class="hint">正在安装依赖，下载速度取决于网络；可以关闭设置窗口，任务会继续。</p>
            <p v-if="job.error" class="install-error">{{ job.error }}</p>
          </div>
        </template>
        <p v-if="game.comfy?.error" class="hint">{{ game.comfy.error }}</p>
      </section>

      <section>
        <h4 class="section-label">界面记忆</h4>
        <p class="hint">
          选择的 RPG 本与槽位记在浏览器 localStorage（<code>rpg.client.module</code> / <code>rpg.client.slot</code>），
          下次打开会自动回到同一档。
        </p>
      </section>
    </div>

    <template #footer>
      <n-space justify="end">
        <n-button @click="emit('update:show', false)">关闭</n-button>
        <n-button type="primary" :loading="saving" :disabled="probingModel || game.busy" @click="submit">保存配置</n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<style scoped>
.settings { display: flex; flex-direction: column; gap: 20px; max-height: calc(100vh - 190px); overflow-y: auto; padding-right: 8px; }
section { display: flex; flex-direction: column; }
.lbl { font-size: 12px; color: var(--text-dim); margin: 12px 0 4px; }
.grid2 { display: grid; grid-template-columns: 1fr 140px; gap: 12px; align-items: end; }
.status-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.status-row .dim { font-size: 11.5px; color: var(--text-faint); }
.row { display: flex; align-items: center; gap: 9px; margin-top: 12px; font-size: 12.5px; color: var(--text-dim); cursor: pointer; }
.hint { font-size: 11.5px; color: var(--text-faint); line-height: 1.85; margin: 8px 0 0; }
.hint code { background: #10141a; padding: 1px 5px; border-radius: 4px; border: 1px solid var(--line-soft); }
.actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.environment, .install-progress { padding: 12px; margin-top: 12px; border: 1px solid var(--line-soft); border-radius: 8px; }
.hardware-table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 11.5px; table-layout: fixed; }
.hardware-table th, .hardware-table td { text-align: left; vertical-align: top; padding: 7px 5px; border-bottom: 1px solid var(--line-soft); overflow-wrap: anywhere; }
.hardware-table th:first-child { width: 24%; }
.hardware-table th:last-child { width: 25%; }
.failed, .api-advice { color: #e8ba71; }
.reason { display: block; font-size: 10.5px; margin-top: 3px; }
.api-advice, .install-error { font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; white-space: pre-wrap; }
.install-error { color: #ed8585; }
.install-progress strong, .install-progress p { font-size: 12px; }
.guide-link { color: var(--brass); font-size: 12px; text-decoration: none; }
.clear-key { margin-top: 8px; font-size: 12px; }
.probe-result { font-size: 12px; color: #7dba92; overflow-wrap: anywhere; }

.slider {
  width: 100%;
  accent-color: var(--brass);
  cursor: pointer;
}
</style>
