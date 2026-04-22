import { useEffect, useRef } from 'react';
import { Home, Users, MessageSquare, Database, FileText, UserCog, Pill, AlertTriangle, Calculator, Droplets, BarChart3, Moon, Sun, LogOut } from 'lucide-react';
import { useTheme } from 'next-themes';
import logoImage from 'figma:asset/f438047691c382addfed5c99dfc97977dea5c831.png';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  SidebarHeader,
  SidebarFooter,
  useSidebar
} from './ui/sidebar';
import { useIsShortViewport } from './ui/use-mobile';
import { useAuth } from '../lib/auth-context';
import { Button } from './ui/button';
import { useNavigate, useLocation } from 'react-router-dom';

export function AppSidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { state, toggleSidebar, setOpen, isMobile } = useSidebar();
  const { theme, setTheme } = useTheme();
  const isShortViewport = useIsShortViewport();

  // 橫置手機時高度太小，footer 會占掉大部分空間並擋到選單項目 → 自動收合為 icon-only
  const hasAutoCollapsed = useRef(false);
  useEffect(() => {
    if (isMobile) return;
    if (isShortViewport && !hasAutoCollapsed.current) {
      setOpen(false);
      hasAutoCollapsed.current = true;
    } else if (!isShortViewport) {
      hasAutoCollapsed.current = false;
    }
  }, [isShortViewport, isMobile, setOpen]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const isActive = (path: string) => {
    return location.pathname === path || location.pathname.startsWith(path + '/');
  };

  const isCollapsed = state === 'collapsed';

  // 1) 病人照護（所有角色可見）
  const patientCareItems = [
    { title: '總覽', url: '/dashboard', icon: Home },
    { title: '病人清單', url: '/patients', icon: Users },
    { title: '劑量計算與建議', url: '/pharmacy/dosage', icon: Calculator },
  ];

  // 2) 藥事評估（藥師/管理者可見）— 整合性工作台
  const pharmacyAssessmentItems = (user?.role === 'pharmacist' || user?.role === 'admin') ? [
    { title: '藥事支援工作台', url: '/pharmacy/workstation', icon: Pill },
  ] : [];

  // 3) 藥事工具（藥師/管理者可見）— 獨立查詢工具
  const pharmacyToolItems = (user?.role === 'pharmacist' || user?.role === 'admin') ? [
    { title: '交互作用查詢', url: '/pharmacy/interactions', icon: AlertTriangle },
    { title: '相容性檢核', url: '/pharmacy/compatibility', icon: Droplets },
    { title: '用藥建議與統計', url: '/pharmacy/advice-statistics', icon: BarChart3 },
  ] : [];

  // 4) 溝通（所有角色可見）
  const communicationItems = [
    { title: '團隊聊天室', url: '/chat', icon: MessageSquare },
  ];

  // 5) 系統管理（僅管理者可見）
  const adminItems = user?.role === 'admin' ? [
    { title: '稽核紀錄', url: '/admin/audit', icon: FileText },
    { title: '帳號與權限', url: '/admin/users', icon: UserCog },
    { title: '向量資料庫', url: '/admin/vectors', icon: Database },
  ] : [];

  const renderMenuGroup = (label: string, items: typeof patientCareItems) => (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                asChild
                isActive={isActive(item.url)}
              >
                <a href={item.url} onClick={(e) => {
                  e.preventDefault();
                  navigate(item.url);
                }}>
                  <item.icon />
                  <span>{item.title}</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b overflow-hidden">
        <button
          onClick={toggleSidebar}
          className="w-full cursor-pointer hover:opacity-80 transition-opacity"
          title={isCollapsed ? '展開側邊欄' : '收起側邊欄'}
        >
          {isCollapsed ? (
            <div className="flex items-center justify-center p-2.5">
              <img src={logoImage} alt="ChatICU" className="h-8 w-8 rounded-full shadow-md object-cover" />
            </div>
          ) : (
            <div className="flex items-center gap-3 p-4">
              <img src={logoImage} alt="ChatICU" className="h-12 w-12 rounded-full shadow-lg flex-shrink-0 object-cover" />
              <div className="min-w-0 flex-1 text-left">
                <h2 className="font-bold text-lg text-foreground">ChatICU</h2>
                <p className="text-xs text-muted-foreground truncate">{user?.name} · {user?.unit}</p>
              </div>
            </div>
          )}
        </button>
      </SidebarHeader>

      <SidebarContent>
        {/* 1) 病人照護 */}
        {renderMenuGroup('病人照護', patientCareItems)}

        {/* 2) 藥事評估 */}
        {pharmacyAssessmentItems.length > 0 && (
          <>
            <SidebarSeparator />
            {renderMenuGroup('藥事評估', pharmacyAssessmentItems)}
          </>
        )}

        {/* 3) 藥事工具 */}
        {pharmacyToolItems.length > 0 && (
          renderMenuGroup('藥事工具', pharmacyToolItems)
        )}

        {/* 4) 溝通 */}
        {renderMenuGroup('溝通', communicationItems)}

        {/* 5) 系統管理 */}
        {adminItems.length > 0 && (
          <>
            <SidebarSeparator />
            {renderMenuGroup('系統管理', adminItems)}
          </>
        )}
      </SidebarContent>

      <SidebarFooter className="p-2 border-t space-y-1.5">
        <Button
          variant="outline"
          size={isCollapsed ? 'icon' : 'default'}
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title={theme === 'dark' ? '淺色模式' : '深色模式'}
          className={`${isCollapsed ? 'mx-auto' : 'w-full'} border-border text-foreground hover:bg-muted`}
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {!isCollapsed && <span className="ml-2">{theme === 'dark' ? '淺色模式' : '深色模式'}</span>}
        </Button>
        <Button
          variant="outline"
          size={isCollapsed ? 'icon' : 'default'}
          onClick={handleLogout}
          title="登出"
          className={`${isCollapsed ? 'mx-auto' : 'w-full'} border-border text-foreground hover:bg-muted`}
        >
          <LogOut className="h-4 w-4" />
          {!isCollapsed && <span className="ml-2">登出</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
