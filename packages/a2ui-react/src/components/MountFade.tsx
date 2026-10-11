import { useEffect, useState, type ReactNode } from "react";

export const MOUNT_FADE_DURATION_MS = 300;

export interface MountFadeProps {
  nodeToken: string;
  componentId: string;
  children: ReactNode;
  /** 淡入结束回调（回写 hasMounted 标记） */
  onFadeEnd?: () => void;
}

/**
 * MountFade 是一个纯 UI 包装组件：
 * - 不拦截事件
 * - 不携带布局样式
 * - 仅在新组件挂载时播放 0.3s（即 MOUNT_FADE_DURATION_MS）的淡入
 */
export function MountFade({
  nodeToken,
  componentId,
  children,
  onFadeEnd,
}: MountFadeProps) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    // 以 nodeToken 变化作为重新播放淡入的信号
    setShown(false);
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeToken]);

  useEffect(() => {
    if (!shown) return;
    const timer = setTimeout(() => onFadeEnd?.(), MOUNT_FADE_DURATION_MS);
    return () => clearTimeout(timer);
  }, [shown, onFadeEnd]);

  return (
    <div
      data-component-id={componentId}
      style={{
        opacity: shown ? 1 : 0,
        transition: `opacity ${MOUNT_FADE_DURATION_MS}ms ease-in-out`,
      }}
    >
      {children}
    </div>
  );
}
