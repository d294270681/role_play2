<script setup>
import { computed, ref, watch } from "vue";

import { game, loadConfig, reloadState, saveConfig } from "../store.js";

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
    };
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
  };
  if (form.value.api_key.trim()) patch.api_key = form.value.api_key.trim();
  await saveConfig(patch);
  form.value.api_key = "";
  saving.value = false;
}

/** 后端只有 /api/game/state 会回 comfy.online，用回读存档来重新探测。 */
async function probe() {
  busyProbe.value = true;
  await reloadState();
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
        <h4 class="section-label">ComfyUI 生图</h4>
        <label class="lbl">comfy_url</label>
        <n-input v-model:value="form.comfy_url" placeholder="http://127.0.0.1:8188" />
        <div class="status-row">
          <n-tag :type="game.comfy?.online ? 'success' : 'error'" size="small" round>
            {{ game.comfy?.online ? "在线" : "离线" }}
          </n-tag>
          <span class="dim">{{ game.comfy?.url || "—" }}</span>
          <n-button size="tiny" quaternary :loading="busyProbe" @click="probe">重新检测</n-button>
        </div>
        <p class="hint">
          剧情插图、地点立绘与角色头像都由本机 ComfyUI 出图；离线时回合会照常跑完，只是跳过插图。
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
