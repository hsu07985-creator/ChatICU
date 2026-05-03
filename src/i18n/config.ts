import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import zhTWCommon from './locales/zh-TW/common.json';
import zhTWSidebar from './locales/zh-TW/sidebar.json';
import zhTWErrors from './locales/zh-TW/errors.json';
import zhTWRoles from './locales/zh-TW/roles.json';
import zhTWNotifications from './locales/zh-TW/notifications.json';
import zhTWAuth from './locales/zh-TW/auth.json';
import zhTWDashboard from './locales/zh-TW/dashboard.json';

import enUSCommon from './locales/en-US/common.json';
import enUSSidebar from './locales/en-US/sidebar.json';
import enUSErrors from './locales/en-US/errors.json';
import enUSRoles from './locales/en-US/roles.json';
import enUSNotifications from './locales/en-US/notifications.json';
import enUSAuth from './locales/en-US/auth.json';
import enUSDashboard from './locales/en-US/dashboard.json';

export const SUPPORTED_LANGUAGES = ['zh-TW', 'en-US'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: SupportedLanguage = 'zh-TW';
export const STORAGE_KEY = 'chaticu.lang';

export const NAMESPACES = ['common', 'sidebar', 'errors', 'roles', 'notifications', 'auth', 'dashboard'] as const;

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
    ns: NAMESPACES as unknown as string[],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    detection: {
      // Only honour explicit user choice; don't auto-pick from browser locale.
      // Default users to zh-TW (fallbackLng) until they actively switch.
      order: ['localStorage'],
      lookupLocalStorage: STORAGE_KEY,
      caches: ['localStorage'],
    },
    resources: {
      'zh-TW': {
        common: zhTWCommon,
        sidebar: zhTWSidebar,
        errors: zhTWErrors,
        roles: zhTWRoles,
        notifications: zhTWNotifications,
        auth: zhTWAuth,
        dashboard: zhTWDashboard,
      },
      'en-US': {
        common: enUSCommon,
        sidebar: enUSSidebar,
        errors: enUSErrors,
        roles: enUSRoles,
        notifications: enUSNotifications,
        auth: enUSAuth,
        dashboard: enUSDashboard,
      },
    },
  });

export default i18n;
