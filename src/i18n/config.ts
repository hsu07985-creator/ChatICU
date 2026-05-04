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
import zhTWPatients from './locales/zh-TW/patients.json';
import zhTWPatientDetail from './locales/zh-TW/patient-detail.json';
import zhTWMedicalRecords from './locales/zh-TW/medical-records.json';
import zhTWLabs from './locales/zh-TW/labs.json';
import zhTWScoreTrend from './locales/zh-TW/score-trend.json';
import zhTWPatientTabs from './locales/zh-TW/patient-tabs.json';
import zhTWMedications from './locales/zh-TW/medications.json';
import zhTWMicrobiology from './locales/zh-TW/microbiology.json';
import zhTWDiagnosticReports from './locales/zh-TW/diagnostic-reports.json';
import zhTWPatientChat from './locales/zh-TW/patient-chat.json';
import zhTWChat from './locales/zh-TW/chat.json';
import zhTWPharmacy from './locales/zh-TW/pharmacy.json';
import zhTWAdmin from './locales/zh-TW/admin.json';

import enUSCommon from './locales/en-US/common.json';
import enUSSidebar from './locales/en-US/sidebar.json';
import enUSErrors from './locales/en-US/errors.json';
import enUSRoles from './locales/en-US/roles.json';
import enUSNotifications from './locales/en-US/notifications.json';
import enUSAuth from './locales/en-US/auth.json';
import enUSDashboard from './locales/en-US/dashboard.json';
import enUSPatients from './locales/en-US/patients.json';
import enUSPatientDetail from './locales/en-US/patient-detail.json';
import enUSMedicalRecords from './locales/en-US/medical-records.json';
import enUSLabs from './locales/en-US/labs.json';
import enUSScoreTrend from './locales/en-US/score-trend.json';
import enUSPatientTabs from './locales/en-US/patient-tabs.json';
import enUSMedications from './locales/en-US/medications.json';
import enUSMicrobiology from './locales/en-US/microbiology.json';
import enUSDiagnosticReports from './locales/en-US/diagnostic-reports.json';
import enUSPatientChat from './locales/en-US/patient-chat.json';
import enUSChat from './locales/en-US/chat.json';
import enUSPharmacy from './locales/en-US/pharmacy.json';
import enUSAdmin from './locales/en-US/admin.json';

export const SUPPORTED_LANGUAGES = ['zh-TW', 'en-US'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: SupportedLanguage = 'zh-TW';
export const STORAGE_KEY = 'chaticu.lang';

export const NAMESPACES = ['common', 'sidebar', 'errors', 'roles', 'notifications', 'auth', 'dashboard', 'patients', 'patient-detail', 'medical-records', 'labs', 'score-trend', 'patient-tabs', 'medications', 'microbiology', 'diagnostic-reports', 'patient-chat', 'chat', 'pharmacy', 'admin'] as const;

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
        patients: zhTWPatients,
        'patient-detail': zhTWPatientDetail,
        'medical-records': zhTWMedicalRecords,
        labs: zhTWLabs,
        'score-trend': zhTWScoreTrend,
        'patient-tabs': zhTWPatientTabs,
        medications: zhTWMedications,
        microbiology: zhTWMicrobiology,
        'diagnostic-reports': zhTWDiagnosticReports,
        'patient-chat': zhTWPatientChat,
        chat: zhTWChat,
        pharmacy: zhTWPharmacy,
        admin: zhTWAdmin,
      },
      'en-US': {
        common: enUSCommon,
        sidebar: enUSSidebar,
        errors: enUSErrors,
        roles: enUSRoles,
        notifications: enUSNotifications,
        auth: enUSAuth,
        dashboard: enUSDashboard,
        patients: enUSPatients,
        'patient-detail': enUSPatientDetail,
        'medical-records': enUSMedicalRecords,
        labs: enUSLabs,
        'score-trend': enUSScoreTrend,
        'patient-tabs': enUSPatientTabs,
        medications: enUSMedications,
        microbiology: enUSMicrobiology,
        'diagnostic-reports': enUSDiagnosticReports,
        'patient-chat': enUSPatientChat,
        chat: enUSChat,
        pharmacy: enUSPharmacy,
        admin: enUSAdmin,
      },
    },
  });

export default i18n;
