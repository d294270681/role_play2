<script setup>
import { computed, ref, watch } from "vue";

import { cancelImageSetup, checkImageEnvironment, controlImageRuntime, disableImage, game, loadConfig, loadImageStatus, saveConfig, setupImage } from "../store.js";

const props = defineProps({ show: { type: Boolean, default: false } });
const emit = defineEmits(["update:show"]);

const form = ref({
  base_url: "",
  api_key: "",
  model: "",
  temperature: 0.8,
  stream: true,
  timeout: 180,
  image_profile: "z-image-turbo",
});
const saving = ref(false);
const busyProbe = ref(false);
const wantLocal = ref(false);

watch(
  () => props.show,
  async (open) => {
    if (!open) return;
    const cfg = game.config || (await loadConfig());
    if (!cfg) return;
    form.value = {
      base_url: cfg.base_url || "",
      api_key: "",
      model: cfg.model || "",
      temperature: Number(cfg.temperature ?? 0.8),
      stream: cfg.stream !== false,
      timeout: Number(cfg.timeout ?? 180),
      image_profile: cfg.image_generation?.profile || "z-image-turbo",
    };
    await loadImageStatus();
    wantLocal.value = cfg.image_generation?.enabled === true || game.imageSetup?.active === true;
    if (game.imageSetup?.active && game.imageSetup.profile) form.value.image_profile = game.imageSetup.profile;
  },
);

const keyHint = computed(() => {
  const cfg = game.config;
  if (!cfg?.has_key) return "未配置";
  return cfg.api_key_tail ? `已配置 · 尾号 ${cfg.api_key_tail}` : "已配置";
});

async function submit() {
  saving.value = true;
  const patch = {
    base_url: form.value.base_url.trim(),
    model: form.value.model.trim(),
    temperature: Number(form.value.temperature),
    stream: Boolean(form.value.stream),
    timeout: Number(form.value.timeout),
  };
  if (form.value.api_key.trim()) patch.api_key = form.value.api_key.trim();
  await saveConfig(patch);
  form.value.api_key = "";
  saving.value = false;
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
        <h4 class="section-label">模型接入</h4>
        <div class="status-row">
          <n-tag :type="game.hasKey ? 'success' : 'warning'" size="small" round>
            API Key：{{ keyHint }}
          </n-tag>
          <n-tag v-if="game.echo" type="warning" size="small" round>演示模式（回声引擎）</n-tag>
          <n-tag v-else type="success" size="small" round>真实模型</n-tag>
        </div>

        <label class="lbl">接口地址 base_url</label>
        <n-input v-model:value="form.base_url" placeholder="https://api.openai.com/v1" />

        <label class="lbl">API Key{{ game.hasKey ? "（留空表示不改动）" : "" }}</label>
        <n-input
          v-model:value="form.api_key"
          type="password"
          show-password-on="click"
          :placeholder="game.hasKey ? '已保存，留空则不修改' : 'sk-…（留空即演示模式）'"
        />

        <div class="grid2">
          <div>
            <label class="lbl">模型 model</label>
            <n-input v-model:value="form.model" placeholder="gpt-4o-mini" />
          </div>
          <div>
            <label class="lbl">超时（秒）</label>
            <n-input-number v-model:value="form.timeout" :min="5" :max="900" style="width: 100%" />
          </div>
        </div>

        <label class="lbl">temperature（{{ Number(form.temperature).toFixed(2) }}）</label>
        <input v-model.number="form.temperature" class="slider" type="range" min="0" max="2" step="0.05" />

        <label class="row">
          <n-switch v-model:value="form.stream" />
          <span>流式输出（关闭则等模型一次性返回）</span>
        </label>
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
        <n-button type="primary" :loading="saving" @click="submit">保存配置</n-button>
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

.slider {
  width: 100%;
  accent-color: var(--brass);
  cursor: pointer;
}
</style>
