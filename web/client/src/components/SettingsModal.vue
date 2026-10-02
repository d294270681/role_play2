<script setup>
import { computed, ref, watch } from "vue";

import { controlImageRuntime, game, loadConfig, loadImageStatus, saveConfig } from "../store.js";

const props = defineProps({ show: { type: Boolean, default: false } });
const emit = defineEmits(["update:show"]);

const form = ref({
  base_url: "",
  api_key: "",
  model: "",
  temperature: 0.8,
  stream: true,
  timeout: 180,
  comfy_url: "",
  image_mode: "internal",
  image_profile: "z-image-turbo",
  image_auto_start: true,
});
const saving = ref(false);
const busyProbe = ref(false);

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
      comfy_url: cfg.comfy_url || "",
      image_mode: cfg.image_generation?.mode || "internal",
      image_profile: cfg.image_generation?.profile || "z-image-turbo",
      image_auto_start: cfg.image_generation?.auto_start !== false,
    };
    await loadImageStatus();
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
    comfy_url: form.value.comfy_url.trim(),
    image_generation: { mode: form.value.image_mode, profile: form.value.image_profile, auto_start: form.value.image_auto_start },
  };
  if (form.value.api_key.trim()) patch.api_key = form.value.api_key.trim();
  await saveConfig(patch);
  form.value.api_key = "";
  saving.value = false;
}

const imageOptions = computed(() => (game.comfy?.profiles || []).map((p) => ({
  label: p.title + (p.available || form.value.image_mode === "external" ? "" : "（模型待导入）"),
  value: p.id, disabled: form.value.image_mode === "internal" && !p.available,
})));

async function probe() {
  busyProbe.value = true;
  await loadImageStatus();
  busyProbe.value = false;
}

async function runtime(action) {
  busyProbe.value = true;
  await controlImageRuntime(action);
  busyProbe.value = false;
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    title="设置"
    style="max-width: 620px"
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
        <h4 class="section-label">生图服务</h4>
        <label class="lbl">运行方式</label>
        <n-select v-model:value="form.image_mode" :options="[{ label: '项目内 ComfyUI', value: 'internal' }, { label: '连接外部 ComfyUI', value: 'external' }]" />
        <label class="lbl">出图模型</label>
        <n-select v-model:value="form.image_profile" :options="imageOptions" />
        <template v-if="form.image_mode === 'external'">
          <label class="lbl">ComfyUI 地址</label>
          <n-input v-model:value="form.comfy_url" placeholder="http://127.0.0.1:8188" />
        </template>
        <label v-else class="row">
          <n-switch v-model:value="form.image_auto_start" />
          <span>随游戏自动启动出图服务</span>
        </label>
        <div class="status-row">
          <n-tag :type="game.comfy?.ready ? 'success' : 'warning'" size="small" round>
            {{ game.comfy?.ready ? "可出图" : game.comfy?.state === "starting" ? "启动中" : game.comfy?.online ? "模型未就绪" : "未启动" }}
          </n-tag>
          <span class="dim">{{ game.comfy?.url || "—" }}</span>
          <n-button size="tiny" quaternary :loading="busyProbe" @click="probe">重新检测</n-button>
        </div>
        <div v-if="game.comfy?.mode === 'internal'" class="status-row">
          <n-button size="small" :loading="busyProbe" :disabled="game.comfy?.online || game.busy" @click="runtime('start')">启动出图服务</n-button>
          <n-button size="small" :disabled="!game.comfy?.managed || busyProbe || game.busy" @click="runtime('stop')">停止出图服务</n-button>
        </div>
        <p v-if="game.comfy?.error" class="hint">{{ game.comfy.error }}</p>
        <p class="hint">
          剧情插图、地点立绘与角色头像使用同一出图服务。项目内模式会管理程序、模型和日志；模型按需载入。修改运行方式或模型后先保存配置。
        </p>
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
.settings { display: flex; flex-direction: column; gap: 20px; }
section { display: flex; flex-direction: column; }
.lbl { font-size: 12px; color: var(--text-dim); margin: 12px 0 4px; }
.grid2 { display: grid; grid-template-columns: 1fr 140px; gap: 12px; align-items: end; }
.status-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.status-row .dim { font-size: 11.5px; color: var(--text-faint); }
.row { display: flex; align-items: center; gap: 9px; margin-top: 12px; font-size: 12.5px; color: var(--text-dim); cursor: pointer; }
.hint { font-size: 11.5px; color: var(--text-faint); line-height: 1.85; margin: 8px 0 0; }
.hint code { background: #10141a; padding: 1px 5px; border-radius: 4px; border: 1px solid var(--line-soft); }

.slider {
  width: 100%;
  accent-color: var(--brass);
  cursor: pointer;
}
</style>
