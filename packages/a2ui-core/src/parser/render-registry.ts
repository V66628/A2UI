import type { RenderMap } from "./types.js";

/** 全局 renderMap（由 init 设置，parser 读取） */
let renderMapInstance: RenderMap | null = null;

export function setRenderMap(renderMap: RenderMap | null): void {
  renderMapInstance = renderMap;
}

export function getRenderMap(): RenderMap | null {
  return renderMapInstance;
}
