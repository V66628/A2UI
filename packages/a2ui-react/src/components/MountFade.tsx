import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

/** 新组件入场动画时长（ms）：0.3s 淡入 */
export const MOUNT_FADE_DURATION_MS = 300;

export interface MountFadeProps {
  /** 节点实例代标识：新节点实例（含新 parser/ctx 中同 id 节点）必然不同 */
  nodeToken: string;
  /** 当前包裹节点的组件 id */
  componentId: string;
  /** 包裹的组件节点 */
  children: ReactNode;
  /** parser 侧挂载标记：false 表示新识别组件，需播放淡入 */
  hasMounted: boolean;
  /** 动画结束回调：经 RenderContext.markMounted 回写 store 清除标记 */
  onFadeEnd: () => void;
}

/**
 * stream 组件入场包装：opacity 0 → 1，0.3s 淡入；结束后经 onFadeEnd 回写标记。
 *
 * 触发以 nodeToken 为准：
 * - parser 每条消息后 rerenderAllNodes 会为全部节点生成新元素对象，
 *   但同一节点实例的 nodeToken 不变，effect 不重跑，已挂载组件不会重播；
 * - React 复用了同 componentId 的实例、但底层已是新节点实例时
 * （如整加载后立即在同结构树上开始流式），nodeToken 变化，
 * 重新走「复位为 0 → 下一帧淡入 → 结束回写」，新节点标记不会丢失；
 * - 新到达的兄弟节点首次挂载自然播放。
 */
export function MountFade({
  nodeToken,
  children,
  hasMounted,
  onFadeEnd,
}: MountFadeProps) {
  const [shown, setShown] = useState(hasMounted);

  useEffect(() => {
    // 用户偏好减弱动效：直接呈现并清除标记，不播放过渡
    const reduceMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setShown(true);
      onFadeEnd();
      return;
    }
    // 已挂载：仅保证可见，不再播放、不再上报
    if (hasMounted) {
      setShown(true);
      return;
    }
    // 复位为不可见（实例复用到新节点时旧 shown 可能为 true）
    setShown(false);
    // 下一帧切到 1，CSS transition 才会生效
    const raf = requestAnimationFrame(() => setShown(true));
    // 0.3s 动画结束 → 回写 hasMounted。
    // 同时兜底 setShown(true)：后台标签 / 隐藏环境 rAF 会被暂停，
    // 保证组件最终一定可见（状态变化同样触发 0.3s 淡入），标记与可见性同步。
    const timer = setTimeout(() => {
      setShown(true);
      onFadeEnd();
    }, MOUNT_FADE_DURATION_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
    // 仅在节点实例代标识变化时重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeToken]);

  const style: CSSProperties = {
    opacity: shown ? 1 : 0,
    transition: `opacity ${MOUNT_FADE_DURATION_MS}ms ease-in-out`,
  };

  return <div style={style}>{children}</div>;
}
