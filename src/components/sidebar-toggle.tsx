import { PanelLeft } from 'lucide-react';
import { Button } from './ui/button';
import { useSidebar } from './ui/sidebar';

export function SidebarToggle() {
  const { toggleSidebar, state } = useSidebar();
  const isCollapsed = state === 'collapsed';
  const leftPosition = isCollapsed
    ? 'calc(var(--sidebar-width-icon) + 0.75rem)'
    : 'calc(var(--sidebar-width) - 3rem)';

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleSidebar}
      onMouseUp={(event) => event.currentTarget.blur()}
      className="fixed top-3 z-50 h-9 w-9 border border-gray-200 bg-white shadow-sm transition-all duration-200 hover:border-[var(--color-brand)]/30 hover:bg-slate-50"
      style={{ left: leftPosition }}
      aria-label={isCollapsed ? '展開側邊欄' : '收起側邊欄'}
      title={isCollapsed ? '展開側邊欄' : '收起側邊欄'}
    >
      <PanelLeft className="h-4 w-4 text-foreground" />
    </Button>
  );
}
