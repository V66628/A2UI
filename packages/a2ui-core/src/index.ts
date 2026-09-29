// a2ui-core: UI 组件库与渲染引擎入口
// 子模块：
// - parser: 解析 a2ui 协议
// - vnode: 映射管理 a2ui 协议生成的组件
// - treebuilder: 构建 a2ui 协议生成的组件树
// - store: 协议 / surface / 组件节点 / 错误信息的状态管理

export * from "./parser/index.js";
export * from "./store/index.js";
export * from "./treebuilder/index.js";
