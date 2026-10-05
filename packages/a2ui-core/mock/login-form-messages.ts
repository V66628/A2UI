/**
 * 登录表单 mock（v0.8 · 数据绑定）
 *
 * 对应 specification/json/catalogs/basic/examples/00_simple-login-form.json：
 *
 *   1. dataModelUpdate path "/"：整模型替换，初始化 username / password
 *   2. 逐组件 surfaceUpdate（父容器先于子组件）：
 *        root (Column)
 *        ├── form_title "Login" (h2)
 *        ├── username_field  TextField /username（shortText）
 *        ├── password_field  TextField /password（obscured）
 *        └── submit_button   Button primary, action login_submitted
 *              └── submit_label "Sign In"
 *        Button 的 context: user -> /username, pass -> /password
 *   3. beginRendering
 *
 * TextField 输入乐观写入本地 dataModel 并重渲染；点击 Sign In 派发 userAction。
 * 整份加载与逐条推送使用同一数组。
 */
export const messages: string[] = [
  '{"dataModelUpdate":{"surfaceId":"main","path":"/","contents":[{"key":"username","valueString":""},{"key":"password","valueString":""}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"root","component":{"Column":{"children":{"explicitList":["form_title","username_field","password_field","submit_button"]},"distribution":"start","alignment":"stretch"}}}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"form_title","component":{"Text":{"text":{"literalString":"Login"},"usageHint":"h2"}}}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"username_field","component":{"TextField":{"label":{"literalString":"Username"},"text":{"path":"/username"},"textFieldType":"shortText"}}}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"password_field","component":{"TextField":{"label":{"literalString":"Password"},"text":{"path":"/password"},"textFieldType":"obscured"}}}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"submit_button","component":{"Button":{"child":"submit_label","primary":true,"action":{"name":"login_submitted","context":[{"key":"user","value":{"path":"/username"}},{"key":"pass","value":{"path":"/password"}}]}}}}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"submit_label","component":{"Text":{"text":{"literalString":"Sign In"}}}}]}}',
  '{"beginRendering":{"surfaceId":"main","root":"root"}}',
];
