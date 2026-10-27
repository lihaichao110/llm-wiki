import type { WikiGraph } from "@/view/readWikiGraph";
import { attachHover, attachSearch, createTextElement, focusNode, getElement, showDetails } from "@/view/clientInteractions";
import cytoscape, { type NodeSingular } from "cytoscape";

/** 通过柔和的颜色区分可交互节点和关系线。 */
const NODE_COLOR = "#3d8dbd";
const SELECTED_COLOR = "#f0a94c";
/** 选中时仅更换文字颜色，保持节点大小和视图缩放不变。 */
const SELECTED_TEXT_COLOR = "#a85812";
/** 悬停聚焦使用同一组紫色，让目录线与概念关系线有一致的视觉反馈。 */
const HOVER_COLOR = "#7950bd";
const HOVER_TEXT_COLOR = "#56358e";
/** 悬停样式的渐变时长（毫秒）；系统要求减少动态效果时改为 0。 */
const HOVER_TRANSITION_MS = 200;

/** 目录节点在内圈按顺序排列，额外概念放到后续外圈。 */
const FIRST_RING_CAPACITY = 10;
const RING_CAPACITY_STEP = 8;
const FIRST_RING_RADIUS = 180;
const RING_RADIUS_STEP = 150;

/**
 * 以 index 为中心计算同心环位置；关系线不参与布局。
 *
 * @param graph 当前图数据。
 * @returns 按节点 ID 索引的画布坐标。
 */
function getRadialPositions(graph: WikiGraph): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const root = graph.nodes.find((node) => node.kind === "index");
  if (!root) {
    throw new Error("图数据缺少 index 根节点。");
  }
  positions.set(root.id, { x: 0, y: 0 });

  const directoryIds = graph.edges
    .filter((edge) => edge.kind === "directory")
    .map((edge) => edge.target);
  const listedIds = new Set(directoryIds);
  const unlistedIds = graph.nodes
    .filter((node) => node.kind === "concept" && !listedIds.has(node.id))
    .map((node) => node.id);
  let ring = 0;
  for (const group of [directoryIds, unlistedIds]) {
    for (let offset = 0; offset < group.length;) {
      const capacity = FIRST_RING_CAPACITY + ring * RING_CAPACITY_STEP;
      const ids = group.slice(offset, offset + capacity);
      const radius = FIRST_RING_RADIUS + ring * RING_RADIUS_STEP;
      ids.forEach((id, position) => {
        const angle = -Math.PI / 2 + 2 * Math.PI * position / ids.length;
        positions.set(id, { x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
      });
      offset += ids.length;
      ring++;
    }
  }
  return positions;
}

/**
 * 从本地接口获取最新图数据并初始化交互式视图。
 *
 * @returns 页面初始化完成后结束。
 * @throws 接口返回错误或图形初始化失败时抛出错误。
 */
async function initializeView(): Promise<void> {
  const response = await fetch("/api/graph", { cache: "no-store" });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const message = typeof payload === "object" && payload !== null && "error" in payload
      ? String(payload.error)
      : `HTTP ${response.status}`;
    throw new Error(message);
  }
  const graph = payload as WikiGraph;
  const conceptCount = graph.nodes.filter((node) => node.kind === "concept").length;
  const relatedCount = graph.edges.filter((edge) => edge.kind === "related").length;
  getElement<HTMLElement>("graph-count").textContent = `${conceptCount} 个概念 · ${relatedCount} 条概念关系`;
  const positions = getRadialPositions(graph);
  const transitionDuration = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? 0
    : HOVER_TRANSITION_MS;

  const cy = cytoscape({
    container: getElement<HTMLElement>("graph"),
    // 固定预设布局中的节点位置，同时保留画布平移、缩放和节点点击。
    autoungrabify: true,
    elements: [
      ...graph.nodes.map((node) => ({ data: { id: node.id, label: node.title }, classes: node.kind })),
      ...graph.edges.map((edge) => ({ data: { id: edge.id, source: edge.source, target: edge.target }, classes: edge.kind })),
    ],
    layout: { name: "preset", positions: Object.fromEntries(positions), fit: true, padding: 48 },
    style: [
      // 过渡写在基础样式上，悬停类移除时也能平滑恢复。
      {
        selector: "node",
        style: {
          "background-color": NODE_COLOR,
          label: "data(label)",
          color: "#21384b",
          "font-size": 9,
          "text-wrap": "wrap",
          "text-max-width": "86px",
          "text-valign": "bottom",
          "text-margin-y": 6,
          width: 12,
          height: 12,
          "transition-property": "background-color, color, opacity",
          "transition-duration": transitionDuration,
          "transition-timing-function": "ease-in-out",
        },
      },
      { selector: "node.index", style: { "background-color": "#245675", "font-size": 11, width: 18, height: 18 } },
      {
        selector: "edge",
        style: {
          "transition-property": "line-color, width, opacity",
          "transition-duration": transitionDuration,
          "transition-timing-function": "ease-in-out",
        },
      },
      { selector: "edge.related", style: { width: 1.2, "line-color": "#a8bbca", opacity: 0.55, "curve-style": "bezier" } },
      { selector: "edge.directory", style: { width: 1, "line-color": "#b7c8d4", opacity: 0.7, "line-style": "dashed" } },
      { selector: "node.selected", style: { "background-color": SELECTED_COLOR, color: SELECTED_TEXT_COLOR } },
      { selector: "node.dimmed", style: { opacity: 0.2 } },
      { selector: "node.hover-muted", style: { opacity: 0.12 } },
      { selector: "edge.hover-muted", style: { opacity: 0.08 } },
      { selector: "node.hover-neighbor", style: { "background-color": HOVER_COLOR, color: HOVER_TEXT_COLOR, opacity: 1 } },
      { selector: "edge.hover-linked", style: { "line-color": HOVER_COLOR, width: 1.8, opacity: 1 } },
      { selector: "node.hover-focused", style: { "background-color": HOVER_COLOR, color: HOVER_TEXT_COLOR, opacity: 1 } },
    ],
  });
  cy.on("tap", "node", (event) => {
    const element = event.target as NodeSingular;
    focusNode(element.id(), cy, graph);
  });
  attachHover(cy);
  attachSearch(cy, graph);

  if (graph.warnings.length > 0) {
    const firstNode = graph.nodes[0];
    if (firstNode) {
      showDetails(firstNode, graph, (id) => focusNode(id, cy, graph, true));
    }
  }
}

void initializeView().catch((error: unknown) => {
  getElement<HTMLElement>("graph-count").textContent = "图数据加载失败";
  const details = getElement<HTMLElement>("details");
  details.replaceChildren(
    createTextElement("h2", "无法显示关系图"),
    createTextElement("p", error instanceof Error ? error.message : String(error)),
  );
});
