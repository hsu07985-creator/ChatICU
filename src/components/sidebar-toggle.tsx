import { PanelLeft } from 'lucide-react';
import { Button } from './ui/button';
import { useSidebar } from './ui/sidebar';

export function SidebarToggle() {
  const { toggleSidebar, state } = useSidebar();
  const isCollapsed = state === 'collapsed';

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleSidebar}
      className={`fixed top-4 z-50 h-10 w-10 bg-white border border-gray-200 shadow-md hover:bg-[#f8f9fa] hover:border-[#7f265b]/30 transition-all duration-200 rounded-lg ${
        isCollapsed ? 'left-[3.5rem]' : 'left-[15.5rem]'
      }`}
      aria-label={isCollapsed ? '展開側邊欄' : '收起側邊欄'}
      title={isCollapsed ? '展開側邊欄' : '收起側邊欄'}
    >
      <PanelLeft className="h-5 w-5 text-[#1a1a1a]" />
    </Button>
  );
}