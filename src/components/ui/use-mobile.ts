import * as React from "react";

const MOBILE_BREAKPOINT = 768;
const SHORT_VIEWPORT_HEIGHT = 500;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(
    undefined,
  );

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}

// 橫置手機（寬度足夠但高度很小）時，sidebar 若保持展開會被 footer 擋到，
// 使用此 hook 讓 sidebar 在此情境下自動收合為 icon-only。
export function useIsShortViewport() {
  const [isShort, setIsShort] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(
      `(max-height: ${SHORT_VIEWPORT_HEIGHT - 1}px)`,
    );
    const onChange = () => {
      setIsShort(window.innerHeight < SHORT_VIEWPORT_HEIGHT);
    };
    mql.addEventListener("change", onChange);
    setIsShort(window.innerHeight < SHORT_VIEWPORT_HEIGHT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isShort;
}
