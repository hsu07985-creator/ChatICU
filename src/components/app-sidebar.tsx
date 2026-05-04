import { useEffect, useRef } from 'react';
import { Home, Users, MessageSquare, FileText, UserCog, Pill, AlertTriangle, Calculator, Droplets, BarChart3, Moon, Sun, LogOut, Sparkles, Archive, Copy, Library, Globe } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useTranslation } from 'react-i18next';
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
  SidebarHeader,
  SidebarFooter,
  useSidebar
} from './ui/sidebar';
import { useIsShortViewport } from './ui/use-mobile';
import { useAuth } from '../lib/auth-context';
import { Button } from './ui/button';
import { useNavigate, useLocation } from 'react-router-dom';
import { useNotificationSummary } from '../hooks/use-notification-summary';
import { useTeamChatUnread } from '../hooks/use-team-chat-unread';
import { useLanguage } from '../i18n/use-language';

export function AppSidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { state, toggleSidebar, setOpen, isMobile } = useSidebar();
  const { theme, setTheme } = useTheme();
  const isShortViewport = useIsShortViewport();
  const { summary: notifSummary } = useNotificationSummary(!!user);
  // Kept for any future sidebar item that wants the global bell count.
  void notifSummary;

  const { t } = useTranslation(['sidebar']);
  const { current: currentLang, toggle: toggleLanguage } = useLanguage();

  // Per-user team-chat unread count (separate from the global bell).
  const { count: chatUnread } = useTeamChatUnread(!!user);
  const chatTitle = chatUnread > 0
    ? t('sidebar:badge.newMessages', { count: chatUnread })
    : undefined;

  // 橫置手機時高度太小，footer 會占掉大部分空間並擋到選單項目 → 自動收合為 icon-only
  // 視窗恢復高度時要自動展開回來，否則會卡在 icon-only 狀態（sidebar_state cookie 讓問題更明顯）
  const hasAutoCollapsed = useRef(false);
  useEffect(() => {
    if (isMobile) return;
    if (isShortViewport && !hasAutoCollapsed.current) {
      setOpen(false);
      hasAutoCollapsed.current = true;
    } else if (!isShortViewport && hasAutoCollapsed.current) {
      setOpen(true);
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
  // 手機橫置時 Sheet drawer 永遠展開，無法走 icon-only；footer 兩顆 default button 疊起來會擋到 menu。
  // 短視窗 + 非 collapsed 時改用並排 icon-only，讓出垂直空間。
  const compactFooter = isShortViewport && !isCollapsed;

  // 1) 病人照護（所有角色可見）
  const patientCareItems: MenuItem[] = [
    { title: t('sidebar:items.dashboard'), url: '/dashboard', icon: Home },
    { title: t('sidebar:items.patients'), url: '/patients', icon: Users },
    { title: t('sidebar:items.discharged'), url: '/patients/discharged', icon: Archive },
  ];

  // 2) 藥事評估（藥師/管理者可見）— 整合性工作台
  const pharmacyAssessmentItems: MenuItem[] = (user?.role === 'pharmacist' || user?.role === 'admin') ? [
    { title: t('sidebar:items.workstation'), url: '/pharmacy/workstation', icon: Pill },
  ] : [];

  // 3) 藥事工具（藥師/管理者可見）— 獨立查詢工具
  const pharmacyToolItems: MenuItem[] = (user?.role === 'pharmacist' || user?.role === 'admin') ? [
    { title: t('sidebar:items.dosage'), url: '/pharmacy/dosage', icon: Calculator },
    { title: t('sidebar:items.interactions'), url: '/pharmacy/interactions', icon: AlertTriangle },
    { title: t('sidebar:items.duplicates'), url: '/pharmacy/duplicates', icon: Copy },
    { title: t('sidebar:items.compatibility'), url: '/pharmacy/compatibility', icon: Droplets },
    { title: t('sidebar:items.drugLibrary'), url: '/pharmacy/drug-library', icon: Library },
    { title: t('sidebar:items.adviceStatistics'), url: '/pharmacy/advice-statistics', icon: BarChart3 },
  ] : [];

  // 4) 溝通（所有角色可見）
  const communicationItems: MenuItem[] = [
    { title: t('sidebar:items.aiChat'), url: '/ai-chat', icon: Sparkles },
    {
      title: t('sidebar:items.teamChat'),
      url: '/chat',
      icon: MessageSquare,
      badge: chatUnread > 0 ? chatUnread : undefined,
      badgeTitle: chatTitle,
    },
  ];

  // 5) 系統管理（僅管理者可見）
  const adminItems: MenuItem[] = user?.role === 'admin' ? [
    { title: t('sidebar:items.audit'), url: '/admin/audit', icon: FileText },
    { title: t('sidebar:items.users'), url: '/admin/users', icon: UserCog },
  ] : [];

  const renderMenuGroup = (label: string, items: MenuItem[]) => (
    <SidebarGroup className="py-1">
      <SidebarGroupLabel className="h-6">{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.url}>
              <SidebarMenuButton
                asChild
                isActive={isActive(item.url)}
                tooltip={item.title}
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
                      aria-label={t('sidebar:badge.unreadAria', { count: item.badge })}
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

  // Language toggle button: single-char target-language label paired with a
  // Globe icon. zh-TW mode shows "英" (target = English); en-US mode shows
  // "中" (target = Chinese). Following common bilingual-site convention the
  // label says what you'll get after clicking, not what you currently are.
  const langButtonLabel = currentLang === 'zh-TW' ? '英' : '中';
  const langButtonTitle = currentLang === 'zh-TW'
    ? t('sidebar:footer.switchToEnglish')
    : t('sidebar:footer.switchToChinese');

  const themeLabel = theme === 'dark'
    ? t('sidebar:footer.lightMode')
    : t('sidebar:footer.darkMode');
  const logoutLabel = t('sidebar:footer.logout');

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b overflow-hidden">
        <button
          onClick={toggleSidebar}
          className="w-full cursor-pointer hover:opacity-80 transition-opacity"
          title={isCollapsed ? t('sidebar:header.expand') : t('sidebar:header.collapse')}
        >
          {isCollapsed ? (
            <div className="flex items-center justify-center py-2">
              <img src={logoImage} alt="ChatICU" className="h-7 w-7 aspect-square shrink-0 rounded-full shadow-md object-cover" />
            </div>
          ) : (
            <div className="flex items-center gap-3 p-4">
              <img src={logoImage} alt="ChatICU" className="h-12 w-12 rounded-full shadow-lg flex-shrink-0 object-cover" />
              <div className="min-w-0 flex-1 text-left">
                {/* eslint-disable-next-line i18next/no-literal-string -- product brand name, intentionally not translated */}
                <h2 className="font-bold text-lg text-foreground">ChatICU</h2>
                <p className="text-xs text-muted-foreground truncate">{user?.name} · {user?.unit}</p>
              </div>
            </div>
          )}
        </button>
      </SidebarHeader>

      <SidebarContent className="gap-0.5">
        {/* 1) 病人照護 */}
        {renderMenuGroup(t('sidebar:groups.patientCare'), patientCareItems)}

        {/* 2) 藥事評估 */}
        {pharmacyAssessmentItems.length > 0 &&
          renderMenuGroup(t('sidebar:groups.pharmacyAssessment'), pharmacyAssessmentItems)}

        {/* 3) 藥事工具 */}
        {pharmacyToolItems.length > 0 &&
          renderMenuGroup(t('sidebar:groups.pharmacyTools'), pharmacyToolItems)}

        {/* 4) 溝通 */}
        {renderMenuGroup(t('sidebar:groups.communication'), communicationItems)}

        {/* 5) 系統管理 */}
        {adminItems.length > 0 && renderMenuGroup(t('sidebar:groups.admin'), adminItems)}
      </SidebarContent>

      <SidebarFooter className="p-2 border-t">
        {/* Layout:
            - Expanded normal:  [theme | language] (50/50) → [logout] (full width)
            - compactFooter (short viewport):  [theme][lang][logout] all icons in a row
            - Collapsed (icon-only):  three icons stacked vertically
        */}
        <div className={compactFooter ? 'flex gap-1.5' : 'space-y-1.5'}>
          {/* Theme + Language paired row in expanded mode */}
          {!isCollapsed && !compactFooter ? (
            <div className="flex gap-1.5">
              <Button
                variant="outline"
                size="default"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                title={themeLabel}
                className="flex-1 min-w-0 border-border text-foreground hover:bg-muted px-2"
              >
                {theme === 'dark' ? <Sun className="h-4 w-4 shrink-0" /> : <Moon className="h-4 w-4 shrink-0" />}
                <span className="ml-2 truncate">{themeLabel}</span>
              </Button>
              <Button
                variant="outline"
                size="default"
                onClick={toggleLanguage}
                title={langButtonTitle}
                aria-label={langButtonTitle}
                className="flex-1 min-w-0 border-border text-foreground hover:bg-muted px-2"
              >
                <Globe className="h-4 w-4 shrink-0" />
                <span className="ml-2 text-xs font-semibold">{langButtonLabel}</span>
              </Button>
            </div>
          ) : (
            <>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                title={themeLabel}
                className={`${isCollapsed ? 'mx-auto' : 'flex-1'} border-border text-foreground hover:bg-muted`}
              >
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={toggleLanguage}
                title={langButtonTitle}
                aria-label={langButtonTitle}
                className={`${isCollapsed ? 'mx-auto' : 'flex-1'} border-border text-foreground hover:bg-muted`}
              >
                <Globe className="h-4 w-4" />
              </Button>
            </>
          )}
          <Button
            variant="outline"
            size={isCollapsed || compactFooter ? 'icon' : 'default'}
            onClick={handleLogout}
            title={logoutLabel}
            className={`${isCollapsed ? 'mx-auto' : compactFooter ? 'flex-1' : 'w-full'} border-border text-foreground hover:bg-muted`}
          >
            <LogOut className="h-4 w-4" />
            {!isCollapsed && !compactFooter && <span className="ml-2">{logoutLabel}</span>}
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
