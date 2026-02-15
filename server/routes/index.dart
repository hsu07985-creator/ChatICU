import 'package:dart_frog/dart_frog.dart';

Response onRequest(RequestContext context) {
  return Response.json(
    body: {
      'name': 'ChatICU API',
      'version': '1.0.0',
      'description': 'ChatICU 後端 REST API (Dart Frog)',
      'endpoints': {
        'auth': {
          'POST /auth/login': '用戶登入',
          'POST /auth/logout': '用戶登出',
          'POST /auth/refresh': '刷新 Token',
          'GET /auth/me': '獲取當前用戶資訊',
        },
        'patients': {
          'GET /patients': '獲取病人列表',
          'GET /patients/:id': '獲取病人詳情',
          'PATCH /patients/:id': '更新病人資料',
        },
        'labData': {
          'GET /patients/:id/lab-data/latest': '獲取最新檢驗數據',
          'GET /patients/:id/lab-data/trends': '獲取檢驗趨勢',
          'PATCH /patients/:id/lab-data/:labDataId/correct': '校正檢驗數據',
        },
        'vitalSigns': {
          'GET /patients/:id/vital-signs/latest': '獲取最新生命徵象',
          'GET /patients/:id/vital-signs/trends': '獲取生命徵象趨勢',
        },
        'ventilator': {
          'GET /patients/:id/ventilator/latest': '獲取最新呼吸器設定',
          'GET /patients/:id/ventilator/trends': '獲取呼吸器趨勢',
          'GET /patients/:id/ventilator/weaning-assessment': '獲取脫機評估',
        },
        'medications': {
          'GET /patients/:id/medications': '獲取用藥列表',
          'POST /patients/:id/medications': '新增處方',
          'PATCH /patients/:id/medications/:medicationId': '更新處方',
        },
        'messages': {
          'GET /patients/:id/messages': '獲取留言列表',
          'POST /patients/:id/messages': '發送留言',
          'PATCH /patients/:id/messages/:messageId/read': '標記已讀',
        },
        'team': {
          'GET /team/chat': '獲取團隊聊天',
          'POST /team/chat': '發送團隊訊息',
          'PATCH /team/chat/:messageId/pin': '釘選/取消釘選訊息',
        },
        'dashboard': {
          'GET /dashboard/stats': '獲取儀表板統計數據',
        },
        'admin': {
          'GET /admin/audit-logs': '獲取稽核日誌（管理員）',
          'GET /admin/users': '獲取用戶列表（管理員）',
          'POST /admin/users': '新增用戶（管理員）',
          'GET /admin/users/:userId': '獲取用戶詳情（管理員）',
          'PATCH /admin/users/:userId': '更新用戶（管理員）',
          'GET /admin/vectors': '獲取向量資料庫列表（管理員）',
          'POST /admin/vectors/upload': '上傳文件到向量資料庫（管理員）',
          'POST /admin/vectors/:databaseId/rebuild': '重建向量索引（管理員）',
        },
        'pharmacy': {
          'GET /pharmacy/error-reports': '獲取用藥錯誤回報列表',
          'POST /pharmacy/error-reports': '新增用藥錯誤回報',
          'PATCH /pharmacy/error-reports/:reportId': '更新用藥錯誤回報',
          'GET /pharmacy/advice-statistics': '獲取用藥建議統計',
        },
      },
      'testAccounts': {
        'nurse': 'nurse / nurse',
        'doctor': 'doctor / doctor',
        'admin': 'admin / admin',
        'pharmacist': 'pharmacist / pharmacist',
      },
    },
  );
}
