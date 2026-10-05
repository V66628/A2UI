# dataModelUpdate 与数据绑定能力 Implementation Plan

## Repository Research

### 协议要求（specification/json）
- `dataModelUpdate`（server_to_client.json L70-134）：必填 `surfaceId`、`contents`，可选 `path`。
  - `path` 省略或为 `"/"`：**整个数据模型被替换**；
  - 嵌套路径（如 `/user/name`）：定位到模型内该位置，contents 中每个 `{key, value*}` 相对于该位置写入；
  - typed value：`valueString / valueNumber / valueBoolean / valueMap`（valueMap 为邻接表数组，递归展开）。
- 组件属性中的值绑定：字符串型 `{literalString | path}`；Button.action.context 的 value 还支持 `literalNumber / literalBoolean`。
- `userAction`（client_to_server.json）：`{name, surfaceId, sourceComponentId, timestamp(ISO8601), context}`，context 为绑定全部解析后的键值对象。
- 最小目录（catalogs/minimal）：Text、Row、Column、Button、TextField；登录表单例子（basic/00_simple-login-form.json）展示完整链路。

### 现有实现现状
- `handleDataModelUpdate`（server-messages.ts L223-251）：**忽略 path**，始终在根上 merge，且 path "/" 未做替换。
- `binding.ts`：仅有字符串型 `ValueBinding{literalString,path}`、`getPathValue`（已支持嵌套与数组数字下标）、`resolveBinding`。
- 每次 `parser.parse`：processInput → rerenderAllNodes（全部节点用当前 dataModel 重新渲染）→ snapshot → treeRenderer。数据更新后自动重渲染的主干已具备。
- RenderContext（parser/types.ts）：有 dataModel、resolveNode、hasMounted/markMounted；**无本地写入与动作派发能力**。
- render-registry.ts：全局单例注册模式（renderMap / treeRenderer / mountNotifier）。
- react 包：Text/Row/Column + MountFade，仅依赖 react（无 antd）；无测试设施。
- 现有测试中没有任何 dataModel 相关引用，修改替换语义不破坏既有断言。

### 已确认决策
1. 组件范围：最小集新增 **Button、TextField**。
2. TextField 绑定 path 时：**乐观写入所属 surface 的本地 dataModel** 并重渲染（不派发动作）。
3. userAction：SDK 维护 outgoing 队列，playground **UI 面板查看/清空**。

## Files and Modules

### a2ui-core
- `src/parser/data-model.ts`（新建）：纯逻辑——path 切分、contents 对象构建、dataModelUpdate 应用（替换/深写）、本地写深写。
- `src/parser/binding.ts`（修改）：新增 `TypedValueBinding`（+literalNumber/literalBoolean）与 `resolveValueBinding`；保留现有 `ValueBinding/resolveBinding`。
- `src/parser/render-registry.ts`（修改）：新增 `EngineHooks`（commitLocalWrite / dispatchUserAction）注册槽；`ActionSink`；`LocalChangeNotifier`。
- `src/parser/types.ts`（修改）：RenderContext 增加 `writeDataModel(path,value)`、`emitUserAction(name,context)`。
- `src/parser/server-messages.ts`（修改）：dataModelUpdate 改调 data-model 模块；三处构造 RenderContext 处补两个回调（经 engineHooks）。
- `src/parser/index.ts`（修改）：createParser 注册 EngineHooks，实现本地写后的「rerenderAllNodes → snapshot → treeRenderer → localChangeNotifier」cycle。
- `src/store/index.ts`（修改）：outgoing actions 队列（get/subscribe/clear）；init 注册 ActionSink（入队+通知）与 LocalChangeNotifier（mirror surfaces/nodes/errors 进 store，不动 rawProtocol）；init 时清空 outgoing。

### a2ui-react
- `src/components/Button.tsx`（新建）：展示型 Button（native button，primary 样式；resolveChild 渲染 child 组件）。
- `src/components/TextField.tsx`（新建）：label + input/textarea；type 映射（obscured→password、number→number、date→date、longText→textarea）。
- `src/renderMap.tsx`（修改）：注册 Button（点击时用**当前模型**解析 action.context → emitUserAction）、TextField（解析 label/text；onChange 且绑定有 path 时 writeDataModel）。
- `src/index.ts`（修改）：导出两个新组件。

### playground / mock
- `packages/a2ui-core/mock/login-form-messages.ts`（新建）：登录表单消息（dataModelUpdate path "/" 初始化 username/password + surfaceUpdate + beginRendering），供整加载与 50 字符分片流式使用。
- `web/a2ui-playground/src/App.tsx`（修改）：订阅 outgoing actions；新增「查看 userAction（N）」Modal（JSON 逐条展示 + 清空按钮），带 data-testid。

## Implementation Steps

1. **data-model.ts 纯逻辑**：`splitPath`、`buildContentsObject`（复用 extractEntryValue，含 valueMap）、`applyDataModelUpdate(surface,{path,contents})`（省略/"/"→整模型替换为新对象；嵌套→中间容器自动创建、目标非对象则重建、逐 key 写入）、`writePathValue`（沿路径不可变更新并回写 surface.dataModel；数组数字下标就地兼容）。
2. **binding.ts 扩展**：新增类型与 `resolveValueBinding`（literalString/Number/Boolean/path 优先级），现有 resolveBinding 保持不变。
3. **render-registry.ts**：加 EngineHooks、ActionSink、LocalChangeNotifier 三组 getter/setter。
4. **types.ts RenderContext**：加 `writeDataModel?`、`emitUserAction?`。
5. **server-messages.ts**：handleDataModelUpdate 校验后委托 applyDataModelUpdate；surfaceUpdate 两处 + rerenderNode 的 context 增加：
   - `writeDataModel: (path,value) => getEngineHooks()?.commitLocalWrite(surfaceId,path,value)`
   - `emitUserAction: (name,context) => getEngineHooks()?.dispatchUserAction(surfaceId,componentId,name,context)`
6. **parser/index.ts**：createParser 内实现 `runLocalCycle()`（rerenderAllNodes → snapshot → trees 交 treeRenderer → localChangeNotifier）；setEngineHooks 注册 commitLocalWrite（调 writePathValue 后 runLocalCycle）与 dispatchUserAction（构造 `{timestamp:new Date().toISOString()}` 交 ActionSink）。
7. **store/index.ts**：outgoing 队列 + listeners（getOutgoingActions/subscribeOutgoingActions/clearOutgoingActions）；init 中 setActionSink（push+notify）、setLocalChangeNotifier（mirror 三表）、init 时 clearOutgoingActions；导出队列 API。
8. **react Button.tsx / TextField.tsx 展示组件**；renderMap 注册适配器（Button 闭包用最新 render context 的 dataModel 解析 context——每次本地写 cycle 会经 rerenderAllNodes 生成新闭包；TextField 受控值来自模型，onChange→writeDataModel）；index.ts 导出。
9. **login-form mock**。
10. **App.tsx**：useSyncExternalStore 订阅 outgoing（带引用缓存）；新增 actions Modal + 清空按钮与 testid。

## Dependencies and Considerations
- 全局单例注册：EngineHooks 与 mountNotifier 同模式，createParser 时覆盖；同一时刻一个活跃 parser（stream 流程已有 activeLoop 防护）。
- 数据模型写入采用「路径沿线新引用 + 回写 surface.dataModel」，替换语义明确，且不依赖 React 直接消费 dataModel。
- Button onClick 的 context 绑定解析必须用点击时最新模型：依赖每次本地写后 rerenderAllNodes 产生新元素/新闭包；context 中 resolveNode 惰性解析 child。
- TextField 受控：输入 → 本地写 → cycle → 新元素回写 value，保证光标与值同步；字面量绑定（无 path）只读不可写，onChange 忽略。
- 不改动现有 parse 路径的 store 同步方式（App 手动 sync），localChangeNotifier 仅服务本地写，避免双写。

## Validation
- `pnpm typecheck`（4 工程）。
- `pnpm --filter @a2ui/core test`（Hard Constraint：core 改动必须跑单测）。新增单测：
  - data-model：path 省略/"/" 整替换、嵌套深写与中间容器创建、目标非对象重建、多 key、valueMap 展开、本地写不可变更新。
  - binding：literalNumber/Boolean/path 解析、数组下标 path。
  - engine 集成：writeDataModel 后 snapshot/treeRenderer/localChangeNotifier 被触发；emitUserAction 经 sink 收到结构完整（ISO timestamp）动作；登录表单端到端（写 username/password → Button 派发 → context 解析为用户输入）。
- 浏览器：加载 login-form → 流式分片（50/50ms）→ 输入用户名/密码（界面实时更新）→ 点击 Sign In → userAction 面板显示 context 含输入值；清空生效；0 错误。

## Risks
- 后台标签 rAF/定时器节流：与本次逻辑无关，浏览器验证留足等待。
- IME 中文输入合成事件：native input onChange 在合成结束后触发，可接受；如出现丢字再按需加 composition 处理。
- 旧 parser 残留 hooks 误写新 ctx：createParser 覆盖注册；reset() 仅换 ctx 不换 hooks（闭包内变量，安全）。
