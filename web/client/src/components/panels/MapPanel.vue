<script setup>
import { computed, ref } from "vue";
import Icon from "../Icon.vue";
import {
  currentLocation,
  game,
  generateImage,
  locationDanger,
  moveTo,
  notify,
  stageAction,
} from "../../store.js";
import { dangerColor, dangerWord } from "../../util.js";
import { mapGraph } from "../../ui.js";
const here = computed(() => currentLocation()),
  selectedName = ref(""),
  zoom = ref(1),
  imgBusy = ref(false);
const graph = computed(() =>
  mapGraph(
    game.map.locations || [],
    game.map.routes || [],
    here.value?.name || "",
  ),
);
const selected = computed(
  () =>
    graph.value.nodes.find((node) => node.name === selectedName.value) ||
    graph.value.nodes.find((node) => node.name === here.value?.name) ||
    graph.value.nodes[0],
);
const isCurrent = computed(() => selected.value?.name === here.value?.name);
const image = computed(() => game.locationImage?.[selected.value?.name] || "");
function reachable(node) {
  if (!node || node.external || node.name === here.value?.name) return false;
  if (!here.value) return false;
  return graph.value.edges.some(
    (edge) =>
      ((edge.from === here.value.name && edge.to === node.name) ||
        (edge.to === here.value.name && edge.from === node.name)) &&
      (edge.route ||
        edge.connections.some(
          (direction) =>
            direction.from === here.value.name && direction.to === node.name,
        )),
  );
}
const route = computed(
  () =>
    graph.value.edges.find(
      (edge) =>
        (edge.from === here.value?.name && edge.to === selected.value?.name) ||
        (edge.to === here.value?.name && edge.from === selected.value?.name),
    )?.route,
);
async function go() {
  if (!reachable(selected.value) || game.busy) return;
  await moveTo(selected.value.name);
}
async function draw() {
  if (!selected.value || selected.value.external) return;
  imgBusy.value = true;
  const name = selected.value.name;
  const data = await generateImage({ kind: "location", name });
  imgBusy.value = false;
  if (data) notify(name + "的地点图已生成", "success");
}
</script>
<template>
  <div v-if="!game.loaded" class="empty-hint">
    载入存档后，可以查看地图、规划路线与移动。
  </div>
  <template v-else>
    <div class="map-layout">
      <section class="card map-card">
        <div class="map-heading">
          <div>
            <h3>地点与路线</h3>
            <p>点击地点查看详情，再决定是否前往。</p>
          </div>
          <div class="map-zoom">
            <button
              class="icon-button"
              aria-label="缩小地图"
              :disabled="zoom <= 0.65"
              @click="zoom = Math.max(0.65, zoom - 0.15)"
            >
              −</button
            ><span>{{ Math.round(zoom * 100) }}%</span
            ><button
              class="icon-button"
              aria-label="放大地图"
              :disabled="zoom >= 1.6"
              @click="zoom = Math.min(1.6, zoom + 0.15)"
            >
              ＋
            </button>
          </div>
        </div>
        <div class="map-canvas">
          <svg
            :viewBox="'0 0 ' + graph.width + ' ' + graph.height"
            :style="{
              width: graph.width * zoom + 'px',
              height: graph.height * zoom + 'px',
            }"
            class="world-graph"
            role="group"
            aria-label="地点路线示意图"
          >
            <defs>
              <pattern
                id="map-grid"
                width="24"
                height="24"
                patternUnits="userSpaceOnUse"
              >
                <circle cx="2" cy="2" r="1" fill="#3c535a" opacity=".35" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#map-grid)" />
            <g
              v-for="edge in graph.edges"
              :key="edge.key"
              class="map-edge"
              :class="{
                near: edge.from === here?.name || edge.to === here?.name,
                route: edge.route,
              }"
            >
              <line
                :x1="edge.a.x"
                :y1="edge.a.y"
                :x2="edge.b.x"
                :y2="edge.b.y"
              />
              <text
                :x="(edge.a.x + edge.b.x) / 2"
                :y="(edge.a.y + edge.b.y) / 2 - 12"
                text-anchor="middle"
              >
                {{
                  edge.route
                    ? (edge.route.code || "路线") +
                      " · " +
                      Math.max(1, Number(edge.route.time_slots) || 1) +
                      "时段"
                    : edge.connections.length > 1
                      ? "相邻"
                      : "单向连接"
                }}
              </text>
            </g>
            <g
              v-for="node in graph.nodes"
              :key="node.name"
              :transform="'translate(' + node.x + ',' + node.y + ')'"
              class="map-node"
              :class="{
                current: node.name === here?.name,
                selected: node.name === selected?.name,
                external: node.external,
                reachable: reachable(node),
              }"
              role="button"
              tabindex="0"
              :aria-label="'查看地点 ' + node.name"
              :aria-pressed="node.name === selected?.name"
              @click="selectedName = node.name"
              @keydown.enter.prevent="selectedName = node.name"
              @keydown.space.prevent="selectedName = node.name"
            >
              <title>
                {{ node.name
                }}{{
                  node.external
                    ? "（路线端点）"
                    : node.name === here?.name
                      ? "（当前位置）"
                      : reachable(node)
                        ? "（可以前往）"
                        : "（不相邻）"
                }}
              </title>
              <rect x="-70" y="-32" width="140" height="65" rx="11" />
              <circle
                v-if="!node.external"
                cx="-48"
                cy="-3"
                r="3"
                :fill="dangerColor(locationDanger(node))"
              />
              <text
                :x="node.external ? 0 : 5"
                y="-1"
                text-anchor="middle"
                class="node-name"
              >
                {{
                  node.name.length > 9 ? node.name.slice(0, 9) + "…" : node.name
                }}
              </text>
              <text x="0" y="19" text-anchor="middle" class="node-meta">
                {{
                  node.external
                    ? "路线端点"
                    : node.name === here?.name
                      ? "你在这里"
                      : reachable(node)
                        ? "可以前往"
                        : "尚不相邻"
                }}
              </text>
            </g>
          </svg>
          <div v-if="!graph.nodes.length" class="empty-hint">
            当前冒险本尚未提供地图资料。
          </div>
        </div>
        <div class="map-legend">
          <span><i class="current-key"></i>当前位置</span
          ><span><i class="reachable-key"></i>相邻地点</span
          ><span><i class="external-key"></i>外部路线端点</span
          ><button
            class="text-button"
            @click="
              selectedName = here?.name || '';
              zoom = 1;
            "
          >
            回到当前位置
          </button>
        </div>
        <p class="hint">
          路线示意图不代表实际地理比例。相邻地点可移动；外部端点暂时只展示路线资料。
        </p>
      </section>
      <section v-if="selected" class="card location-card">
        <div class="location-top">
          <span class="eyebrow">{{
            isCurrent ? "当前位置" : selected.external ? "外部路线" : "地点详情"
          }}</span
          ><Icon name="pin" :size="19" />
        </div>
        <h2>{{ selected.name }}</h2>
        <div class="location-tags">
          <span
            v-if="!selected.external"
            class="tag"
            :class="'danger-' + locationDanger(selected)"
            >{{ dangerWord(locationDanger(selected)) }} · 危险
            {{ locationDanger(selected) }}</span
          ><span v-if="selected.faction" class="tag subtle">{{
            selected.faction
          }}</span>
        </div>
        <button
          v-if="image"
          class="location-image"
          title="放大地点图"
          @click="game.lightbox = { url: image, prompt: selected.name }"
        >
          <img :src="image" :alt="selected.name" />
        </button>
        <p class="location-desc">{{ selected.desc || "暂无地点描述。" }}</p>
        <div v-if="!isCurrent && !selected.external" class="travel-detail">
          <template v-if="reachable(selected)"
            ><span
              >预计耗时<b
                >{{ Math.max(1, Number(route?.time_slots) || 1) }} 时段</b
              ></span
            ><span v-if="route"
              >路线危险度<b :class="'danger-' + (route.danger || 0)">{{
                route.danger ?? "—"
              }}</b></span
            >
            <p v-if="route?.note">{{ route.note }}</p>
            <button class="primary-button" :disabled="game.busy" @click="go">
              <Icon name="arrow" :size="16" />前往{{ selected.name }}
            </button></template
          >
          <p v-else class="hint">
            {{
              here
                ? "与当前位置没有可用的直接路线，请先沿相邻地点探索。"
                : "当前位置未能匹配地图，请确认存档中的地点。"
            }}
          </p>
        </div>
        <div v-if="selected.npcs?.length" class="location-people">
          <h4>这里的人物</h4>
          <div class="chips">
            <span v-for="npc in selected.npcs" :key="npc" class="tag subtle">{{
              npc
            }}</span>
          </div>
        </div>
        <div v-if="selected.actions?.length" class="location-actions">
          <h4>可用行动<span v-if="!isCurrent"> · 抵达后可用</span></h4>
          <button
            v-for="action in selected.actions"
            :key="action"
            class="location-action"
            :disabled="!isCurrent || game.busy"
            @click="
              stageAction(
                '在' + selected.name + '：' + action.split('→')[0].trim(),
              )
            "
          >
            <span>{{ action }}</span
            ><Icon name="chevron" :size="14" />
          </button>
        </div>
        <div v-if="!selected.external" class="location-draw">
          <button
            v-if="game.comfy?.available"
            class="text-button"
            :disabled="imgBusy || game.busy"
            @click="draw"
          >
            <Icon name="image" :size="15" />{{
              imgBusy ? "生成中…" : image ? "重新生成地点图" : "生成地点图"
            }}</button
          ><button v-else class="text-button" @click="game.settingsOpen = true">
            <Icon name="image" :size="15" />配置地点生图
          </button>
        </div>
      </section>
    </div>
    <section v-if="game.map.routes?.length" class="card route-card">
      <h3 class="section-label">路线资料</h3>
      <div class="route-grid">
        <div
          v-for="(route, index) in game.map.routes"
          :key="index"
          class="route-entry"
        >
          <span class="tag gold">{{ route.code || "路线 " + (index + 1) }}</span
          ><b>{{ route.from }} <Icon name="arrow" :size="13" />{{ route.to }}</b
          ><span
            >{{ route.time_slots ?? 1 }} 时段 · 危险
            {{ route.danger ?? "—" }}</span
          >
          <p v-if="route.note">{{ route.note }}</p>
        </div>
      </div>
    </section>
  </template>
</template>
<style scoped>
.map-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 310px;
  gap: 18px;
  align-items: start;
}
.map-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.map-heading h3 {
  margin: 0;
  font-size: 14px;
}
.map-heading p {
  margin: 4px 0 16px;
  color: var(--text-faint);
  font-size: 11px;
}
.map-zoom {
  display: flex;
  gap: 5px;
  align-items: center;
  border: 1px solid var(--line);
  border-radius: 7px;
  padding: 2px 4px;
}
.map-zoom span {
  font-size: 10px;
  color: var(--text-faint);
  min-width: 36px;
  text-align: center;
}
.map-canvas {
  background: var(--ink-900);
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: auto;
  max-height: 520px;
}
.world-graph {
  display: block;
  margin: auto;
}
.map-edge line {
  stroke: #364a53;
  stroke-width: 2;
}
.map-edge.near line {
  stroke: var(--brass-dim);
}
.map-edge.route line {
  stroke-dasharray: 5 5;
}
.map-edge text {
  fill: var(--text-faint);
  font-size: 10px;
  paint-order: stroke;
  stroke: var(--ink-900);
  stroke-width: 5px;
  stroke-linejoin: round;
}
.map-node {
  cursor: pointer;
  outline: none;
}
.map-node rect {
  fill: var(--ink-820);
  stroke: var(--line-bright);
  stroke-width: 1.2;
  transition: stroke 0.2s;
}
.map-node.current rect {
  fill: #263129;
  stroke: var(--brass);
}
.map-node.selected rect,
.map-node:focus-visible rect {
  stroke: var(--brass);
  stroke-width: 2;
}
.map-node.external rect {
  fill: var(--ink-900);
  stroke-dasharray: 4 4;
}
.map-node:hover rect {
  stroke: var(--brass-dim);
}
.node-name {
  fill: var(--text);
  font-size: 12px;
  font-weight: 500;
}
.node-meta {
  fill: var(--text-faint);
  font-size: 9px;
}
.map-node.current .node-meta {
  fill: var(--brass);
}
.map-node.reachable .node-meta {
  fill: var(--moss);
}
.map-legend {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 10px;
  color: var(--text-faint);
  padding: 13px 0 3px;
}
.map-legend > span {
  display: flex;
  gap: 5px;
  align-items: center;
}
.map-legend i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--line-bright);
}
.map-legend .current-key {
  background: var(--brass);
}
.map-legend .reachable-key {
  background: var(--moss);
}
.map-legend .external-key {
  border: 1px dashed var(--text-faint);
  background: none;
  border-radius: 0;
}
.map-legend .text-button {
  margin-left: auto;
  font-size: 10px;
}
.location-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--brass);
}
.eyebrow {
  font-size: 10px;
  color: var(--text-faint);
}
.location-card h2 {
  font-family: var(--serif);
  font-size: 25px;
  margin: 9px 0 11px;
}
.location-tags,
.chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.location-desc {
  font-size: 12px;
  line-height: 1.95;
  color: var(--text-dim);
  margin: 16px 0;
}
.location-image {
  width: 100%;
  border: 0;
  background: none;
  padding: 0;
  margin: 16px 0 0;
  cursor: zoom-in;
}
.location-image img {
  width: 100%;
  max-height: 175px;
  object-fit: cover;
  border-radius: 8px;
}
.travel-detail {
  padding-top: 12px;
  border-top: 1px solid var(--line);
}
.travel-detail > span {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-dim);
  margin-bottom: 6px;
}
.travel-detail b {
  font-weight: 500;
  color: var(--text);
}
.travel-detail p {
  font-size: 11px;
  color: var(--text-faint);
}
.travel-detail > .primary-button {
  width: 100%;
  margin-top: 10px;
}
.location-card h4 {
  font-size: 11px;
  color: var(--text-faint);
  font-weight: 500;
  margin: 18px 0 9px;
}
.location-actions {
  margin-top: 12px;
}
.location-action {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 9px 10px;
  margin-top: 6px;
  text-align: left;
  border: 1px solid var(--line);
  background: var(--ink-860);
  border-radius: 7px;
  color: var(--text-dim);
  font-size: 11px;
  line-height: 1.7;
}
.location-action:hover:not(:disabled) {
  border-color: var(--brass-dim);
  color: var(--brass);
}
.location-draw {
  padding-top: 18px;
}
.route-card {
  margin-top: 18px;
}
.route-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.route-entry {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 14px;
}
.route-entry b {
  display: flex;
  gap: 9px;
  align-items: center;
  font-size: 12px;
  font-weight: 500;
}
.route-entry > span:not(.tag),
.route-entry p {
  font-size: 11px;
  color: var(--text-faint);
  margin: 0;
}
@media (max-width: 1250px) {
  .map-layout {
    grid-template-columns: minmax(0, 1fr) 270px;
    gap: 12px;
  }
  .map-card {
    padding: 18px;
  }
}
@media (max-width: 850px) {
  .map-layout {
    grid-template-columns: 1fr;
  }
  .location-card {
    display: block;
  }
  .map-canvas {
    max-height: 410px;
  }
}
@media (max-width: 560px) {
  .route-grid {
    grid-template-columns: 1fr;
  }
  .map-legend {
    gap: 10px;
    font-size: 9px;
  }
  .map-legend .text-button {
    margin-left: 0;
  }
  .map-heading p {
    font-size: 10px;
  }
}
</style>
