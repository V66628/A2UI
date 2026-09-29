import React from "react";
import ReactDOM from "react-dom/client";
import { getA2UIStore, init, parseProtocol } from "@a2ui/core";
import { renderMap } from "@a2ui/react";
// 引入 mock a2ui 协议原文（v0.8：单个 Text 组件）
import mockJsonl from "../../../packages/a2ui-core/mock/text-v0.8.jsonl?raw";
import App from "./App";

// 1. 初始化 store（传入 renderMap，parser 据此渲染组件），同时写入原始协议
init(mockJsonl, renderMap);

// 2. 通过 parser 解析 mock 协议（解析完成后 treebuilder 返回组件树）
const { surfaces, hydrateNodes, errors, trees } = parseProtocol(mockJsonl);

// 3. 将解析结果写入 store（先写节点，surface.rootNode 引用节点对象）
const storeState = getA2UIStore().getState();
hydrateNodes.forEach((node) => storeState.addHydrateNode(node));
surfaces.forEach((surface) => storeState.addSurface(surface));
errors.forEach((error, index) =>
  storeState.addError(`a2ui-error-${index}`, error)
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App trees={trees} />
  </React.StrictMode>
);
