// API 模組統一匯出
export * from './auth';
export * from './patients';
export * from './lab-data';
export * from './diagnostic-reports';
export * from './vital-signs';
export * from './ventilator';
export * from './medications';
export * from './messages';
export * from './team-chat';
export * from './ai';
export * from './health';
export * from './sync';
export * from './dashboard';
export * from './admin';
export * from './scores';

// 導入命名空間供舊式用法
import * as patientsApi from './patients';
import * as authApi from './auth';
import * as labDataApi from './lab-data';
import * as vitalSignsApi from './vital-signs';
import * as ventilatorApi from './ventilator';
import * as medicationsApi from './medications';
import * as messagesApi from './messages';
import * as teamChatApi from './team-chat';
import * as aiApi from './ai';
import * as healthApi from './health';
import * as syncApi from './sync';
import * as dashboardApi from './dashboard';
import * as adminApi from './admin';
import * as scoresApi from './scores';

// 匯出命名空間
export { patientsApi, authApi, labDataApi, vitalSignsApi, ventilatorApi, medicationsApi, messagesApi, teamChatApi, aiApi, healthApi, syncApi, dashboardApi, adminApi, scoresApi };

// 重新匯出 API client 和 token 管理
export { default as apiClient, tokenManager, getApiBaseUrl } from '../api-client';
