import type { CSSProperties, ReactNode } from "react";
import {
  MessageOutlined,
  AimOutlined,
  PictureOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";

/** 欢迎页上可点击直接填入输入框的示例需求 */
const EXAMPLE_PROMPTS = [
  "生成一个登录表单，包含用户名、密码输入框和登录按钮",
  "做一个商品卡片列表，每个卡片有图片、标题、价格和购买按钮",
  "生成一个个人资料设置页，包含头像、昵称输入框和保存按钮",
];

const FEATURES: Array<{
  icon: ReactNode;
  title: string;
  desc: string;
  color: string;
}> = [
  {
    icon: <MessageOutlined />,
    title: "对话生成界面",
    desc: "用自然语言描述需求，Agent 实时产出 A2UI 协议并原生渲染",
    color: "#1677ff",
  },
  {
    icon: <AimOutlined />,
    title: "点选组件微调",
    desc: "点击预览区任意组件自动回填 ID，多轮对话增量修改样式与布局",
    color: "#52c41a",
  },
  {
    icon: <PictureOutlined />,
    title: "多模态还原",
    desc: "粘贴截图或草图（Ctrl+V），视觉模型对照参考图生成界面",
    color: "#722ed1",
  },
];

const CARD_STYLE: CSSProperties = {
  flex: "1 1 0",
  minWidth: 180,
  background: "#fff",
  border: "1px solid #e8e8ee",
  borderRadius: 12,
  padding: "18px 16px",
  textAlign: "left",
};

export function Welcome({
  onPickPrompt,
}: {
  onPickPrompt: (prompt: string) => void;
}) {
  return (
    <div
      data-testid="welcome-page"
      style={{
        position: "absolute",
        inset: 0,
        overflow: "auto",
        display: "flex",
        flexDirection: "column",
        background:
          "radial-gradient(1200px 500px at 50% -10%, #eef4ff 0%, #f7f9fc 45%, #f7f9fc 100%)",
      }}
    >
      <div
        style={{
          margin: "auto",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: "100%",
          maxWidth: 820,
          padding: "40px 32px",
        }}
      >
        {/* 品牌标识 */}
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            background: "linear-gradient(135deg, #1677ff 0%, #722ed1 100%)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 26,
            boxShadow: "0 8px 24px rgba(22,119,255,0.28)",
            marginBottom: 20,
          }}
        >
          <ThunderboltOutlined />
        </div>

        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: 1,
            color: "#1677ff",
            background: "#e6f0ff",
            borderRadius: 999,
            padding: "3px 12px",
            marginBottom: 14,
          }}
        >
          A2UI · AGENT TO UI
        </div>

        <h1
          style={{
            margin: 0,
            fontSize: 28,
            fontWeight: 700,
            color: "#1a1a2e",
            textAlign: "center",
          }}
        >
          用对话，生成可交互的界面
        </h1>
        <p
          style={{
            margin: "10px 0 0",
            fontSize: 14,
            lineHeight: 1.8,
            color: "#6b7280",
            textAlign: "center",
            maxWidth: 560,
          }}
        >
          在左侧描述你想要的界面，或直接粘贴截图 / 草图， Agent 会生成 A2UI
          协议并在此实时渲染。 点击预览中的组件即可引用它，继续多轮微调。
        </p>

        {/* 能力卡片 */}
        <div
          style={{
            display: "flex",
            gap: 14,
            flexWrap: "wrap",
            justifyContent: "center",
            width: "100%",
            maxWidth: 760,
            marginTop: 32,
          }}
        >
          {FEATURES.map((feature) => (
            <div key={feature.title} style={CARD_STYLE}>
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 9,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 16,
                  color: feature.color,
                  background: `${feature.color}14`,
                  marginBottom: 10,
                }}
              >
                {feature.icon}
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#1f2937" }}>
                {feature.title}
              </div>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 12,
                  lineHeight: 1.7,
                  color: "#8a8f99",
                }}
              >
                {feature.desc}
              </div>
            </div>
          ))}
        </div>

        {/* 示例需求 */}
        <div
          style={{
            marginTop: 32,
            width: "100%",
            maxWidth: 760,
          }}
        >
          <div
            style={{
              fontSize: 12,
              color: "#9ca3af",
              marginBottom: 10,
              textAlign: "center",
            }}
          >
            试试这些例子（点击即可填入输入框）
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              alignItems: "center",
            }}
          >
            {EXAMPLE_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                data-testid="welcome-example"
                onClick={() => onPickPrompt(prompt)}
                style={{
                  cursor: "pointer",
                  width: "100%",
                  maxWidth: 560,
                  textAlign: "left",
                  fontSize: 13,
                  color: "#374151",
                  background: "#fff",
                  border: "1px dashed #d3d8e0",
                  borderRadius: 10,
                  padding: "10px 14px",
                  transition: "all .15s ease",
                }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.borderColor = "#1677ff";
                  event.currentTarget.style.color = "#1677ff";
                  event.currentTarget.style.background = "#f5f9ff";
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.borderColor = "#d3d8e0";
                  event.currentTarget.style.color = "#374151";
                  event.currentTarget.style.background = "#fff";
                }}
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
