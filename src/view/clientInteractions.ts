import type { WikiGraph, WikiGraphNode } from "@/view/readWikiGraph";
import type { Core, NodeSingular } from "cytoscape";

/** 临时样式类集中清理，避免悬停状态残留并覆盖搜索或点击状态。 */
const HOVER_CLASSES = "hover-muted hover-neighbor hover-linked hover-focused";

/**
 * 查找页面中必需的元素，缺失时立即报错以便发现模板与脚本不一致。
 *
 * @param id HTML 元素 ID。
 * @returns 对应的页面元素。
 * @throws 模板缺少对应元素时抛出错误。
 */
export function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`页面缺少 ${id} 元素。`);
  }
  return element as T;
}

/**
 * 以纯文本创建 DOM 元素，避免把 Wiki 内容当作 HTML 执行。
 *
 * @param tagName 元素标签。
 * @param content 要显示的文字。
 * @returns 已设置文字的元素。
 */
export function createTextElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  content: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  element.textContent = content;
  return element;
}

/**
 * 在详情栏展示所选概念和相邻概念。
 *
 * @param node 当前节点的数据。
 * @param graph 当前图数据。
 * @param selectNode 点击相邻概念时执行的定位操作。
 */
export function showDetails(
  node: WikiGraphNode,
  graph: WikiGraph,
  selectNode: (id: string) => void,
): void {
  const details = getElement<HTMLElement>("details");
  details.replaceChildren();
  details.append(createTextElement("h2", node.title));
  details.append(createTextElement("p", node.summary || "暂无摘要。"));

  if (node.tags.length > 0) {
    const tags = document.createElement("div");
    tags.className = "tags";
    for (const tag of node.tags) {
      tags.append(createTextElement("span", tag));
    }
    details.append(tags);
  }

  const neighbors = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.kind !== (node.kind === "index" ? "directory" : "related")) {
      continue;
    }
    if (edge.source === node.id) {
      neighbors.add(edge.target);
    } else if (edge.target === node.id) {
      neighbors.add(edge.source);
    }
  }
  details.append(createTextElement("h3", `${node.kind === "index" ? "目录概念" : "相关概念"}（${neighbors.size}）`));
  if (neighbors.size === 0) {
    details.append(createTextElement("p", node.kind === "index" ? "暂无目录概念。" : "暂无相关概念。"));
  } else {
    const related = document.createElement("div");
    related.className = "related";
    for (const neighbor of graph.nodes.filter((item) => neighbors.has(item.id))) {
      const button = createTextElement("button", neighbor.title);
      button.type = "button";
      button.addEventListener("click", () => selectNode(neighbor.id));
      related.append(button);
    }
    details.append(related);
  }

  if (graph.warnings.length > 0) {
    const notice = document.createElement("div");
    notice.className = "notice";
    notice.append(createTextElement("strong", `数据提示（${graph.warnings.length}）`));
    const list = document.createElement("ul");
    for (const warning of graph.warnings) {
      list.append(createTextElement("li", warning));
    }
    notice.append(list);
    details.append(notice);
  }
}

/**
 * 选择、聚焦并高亮节点，同时更新详情栏。
 *
 * @param id 目标概念节点 ID。
 * @param cy Cytoscape 实例。
 * @param graph 当前图数据。
 * @param center 是否平移视图以定位节点；点击图中节点时保持视图不动。
 */
export function focusNode(id: string, cy: Core, graph: WikiGraph, center = false): void {
  const element = cy.getElementById(id);
  if (element.empty()) {
    return;
  }
  const node = graph.nodes.find((item) => item.id === id);
  if (!node) {
    return;
  }

  cy.nodes().removeClass("selected");
  element.addClass("selected");
  if (center) {
    cy.animate({ center: { eles: element } }, { duration: 250 });
  }
  showDetails(node, graph, (neighborId) => focusNode(neighborId, cy, graph, true));
}

/**
 * 为悬停节点、直接邻居和相连的线添加临时聚焦样式。
 *
 * @param cy Cytoscape 实例。
 * @param node 当前悬停的节点。
 */
function highlightNeighborhood(cy: Core, node: NodeSingular): void {
  const connectedEdges = node.connectedEdges();
  const neighbors = connectedEdges.connectedNodes().not(node);
  cy.batch(() => {
    cy.elements().removeClass(HOVER_CLASSES).addClass("hover-muted");
    connectedEdges.removeClass("hover-muted").addClass("hover-linked");
    neighbors.removeClass("hover-muted").addClass("hover-neighbor");
    node.removeClass("hover-muted").addClass("hover-focused");
  });
}

/**
 * 绑定节点悬停事件；离开时仅移除临时样式，保留搜索和点击状态。
 *
 * @param cy Cytoscape 实例。
 */
export function attachHover(cy: Core): void {
  let hoveredNodeId: string | null = null;
  cy.on("mouseover", "node", (event) => {
    const node = event.target as NodeSingular;
    hoveredNodeId = node.id();
    highlightNeighborhood(cy, node);
  });
  cy.on("mouseout", "node", (event) => {
    if ((event.target as NodeSingular).id() !== hoveredNodeId) {
      return;
    }
    hoveredNodeId = null;
    cy.elements().removeClass(HOVER_CLASSES);
  });
}

/**
 * 按标题或别名检索节点，并提供可点击的定位结果。
 *
 * @param cy Cytoscape 实例。
 * @param graph 当前图数据。
 */
export function attachSearch(cy: Core, graph: WikiGraph): void {
  const search = getElement<HTMLInputElement>("search");
  const results = getElement<HTMLElement>("search-results");
  search.addEventListener("input", () => {
    const query = search.value.trim().toLocaleLowerCase();
    results.replaceChildren();
    cy.nodes().removeClass("dimmed");
    if (!query) {
      return;
    }

    const matches = graph.nodes.filter((node) => node.kind === "concept" &&
      [node.title, ...node.aliases].some((name) => name.toLocaleLowerCase().includes(query)));
    const matchedIds = new Set(matches.map((node) => node.id));
    cy.nodes(".concept").forEach((element) => {
      if (!matchedIds.has(element.id())) {
        element.addClass("dimmed");
      }
    });
    for (const node of matches) {
      const button = createTextElement("button", node.title);
      button.type = "button";
      button.addEventListener("click", () => {
        focusNode(node.id, cy, graph, true);
        results.replaceChildren();
      });
      results.append(button);
    }
    if (matches.length === 0) {
      results.append(createTextElement("p", "没有匹配的概念。"));
    }
  });
}

