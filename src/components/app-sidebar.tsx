import { useEffect, useRef } from 'react';
import { Home, Users, MessageSquare, Database, FileText, UserCog, Pill, AlertTriangle, Calculator, Droplets, BarChart3, Moon, Sun, LogOut, Sparkles, Archive, Copy } from 'lucide-react';
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
import { useNotificationSummary } from '../hooks/use-notification-summary';

export function AppSidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { state, toggleSidebar, setOpen, isMobile } = useSidebar();
  const { theme, setTheme } = useTheme();
  const isShortViewport = useIsShortViewport();
  const { summary: notifSummary } = useNotificationSummary(!!user);
  const notifCount = notifSummary?.total ?? 0;
  const notifTitle = notifSummary
    ? `${notifSummary.mentions} 則 @我的留言，${notifSummary.alerts} 則警示（近 7 天未讀）`
    : undefined;

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

  type MenuItem = {
    title: string;
    url: string;
    icon: typeof Home;
    badge?: number;
    badgeTitle?: string;
  };

  const isActive = (path: string) => {
    return location.pathname === path || location.pathname.startsWith(path + '/');
  };

  const isCollapsed = state === 'collapsed';

  // 1) 病人照護（所有角色可見）
  const patientCareItems = [
    { title: '總覽', url: '/dashboard', icon: Home },
    { title: '病人清單', url: '/patients', icon: Users },
    { title: '已出院病人', url: '/patients/discharged', icon: Archive },
    { title: '劑量計算與建議', url: '/pharmacy/dosage', icon: Calculator },
  ];

  // 2) 藥事評估（藥師/管理者可見）— 整合性工作台
  const pharmacyAssessmentItems = (user?.role === 'pharmacist' || user?.role === 'admin') ? [
    { title: '藥事支援工作台', url: '/pharmacy/workstation', icon: Pill },
  ] : [];

  // 3) 藥事工具（藥師/管理者可見）— 獨立查詢工具
  const pharmacyToolItems = (user?.role === 'pharmacist' || user?.role === 'admin') ? [
    { title: '交互作用查詢', url: '/pharmacy/interactions', icon: AlertTriangle },
    { title: '重複用藥', url: '/pharmacy/duplicates', icon: Copy },
    { title: '相容性檢核', url: '/pharmacy/compatibility', icon: Droplets },
    { title: '用藥建議與統計', url: '/pharmacy/advice-statistics', icon: BarChart3 },
  ] : [];

  // 4) 溝通（所有角色可見）
  const communicationItems: MenuItem[] = [
    { title: 'AI 問答', url: '/ai-chat', icon: Sparkles },
    {
      title: '團隊聊天室',
      url: '/chat',
      icon: MessageSquare,
      badge: notifCount > 0 ? notifCount : undefined,
      badgeTitle: notifTitle,
    },
  ];

  // 5) 系統管理（僅管理者可見）
  const adminItems = user?.role === 'admin' ? [
    { title: '稽核紀錄', url: '/admin/audit', icon: FileText },
    { title: '帳號與權限', url: '/admin/users', icon: UserCog },
    { title: '向量資料庫', url: '/admin/vectors', icon: Database },
  ] : [];

  const renderMenuGroup = (label: string, items: MenuItem[]) => (
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
                <a
                  href={item.url}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(item.url);
                  }}
                  className="relative"
                  title={item.badgeTitle}
                >
                  <item.icon />
                  <span>{item.title}</span>
                  {item.badge ? (
                    <span
                      className={`ml-auto inline-flex items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-semibold text-white min-w-[18px] h-[18px] ${
                        isCollapsed ? 'absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1' : ''
                      }`}
                      aria-label={`未讀通知 ${item.badge}`}
                    >
                      {item.badge > 99 ? '99+' : item.badge}
                    </span>
                  ) : null}
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
