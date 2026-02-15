import apiClient, { getApiBaseUrl } from '../api-client';

// 健康檢查回應類型
interface HealthCheckResponse {
  success: boolean;
  message?: string;
  data?: {
    status: string;
    version: string;
    timestamp: string;
  };
}

/**
 * API 健康檢查
 * 用於驗證前後端連接是否正常
 */
export async function checkApiHealth(): Promise<{
  healthy: boolean;
  baseUrl: string;
  message: string;
  latency?: number;
}> {
  const baseUrl = getApiBaseUrl();
  const startTime = Date.now();

  try {
    const response = await apiClient.get<HealthCheckResponse>('/health', {
      timeout: 5000, // 5 秒超時
    });

    const latency = Date.now() - startTime;

    return {
      healthy: response.data.success === true,
      baseUrl,
      message: response.data.message || 'API 連接正常',
      latency,
    };
  } catch (error) {
    const latency = Date.now() - startTime;

    return {
      healthy: false,
      baseUrl,
      message: error instanceof Error ? error.message : '連接失敗',
      latency,
    };
  }
}

/**
 * 驗證 API 連接狀態
 * 用於開發時快速檢查
 */
export async function validateApiConnection(): Promise<void> {
  console.log('🔍 正在檢查 API 連接...');
  
  const result = await checkApiHealth();
  
  if (result.healthy) {
    console.log(`✅ API 連接成功`);
    console.log(`   📍 URL: ${result.baseUrl}`);
    console.log(`   ⏱️  延遲: ${result.latency}ms`);
  } else {
    console.error(`❌ API 連接失敗`);
    console.error(`   📍 URL: ${result.baseUrl}`);
    console.error(`   💬 錯誤: ${result.message}`);
    console.error(`   💡 請確認後端服務是否已啟動: cd server && dart_frog dev`);
  }
}

