import 'dart:convert';
import 'package:dart_frog/dart_frog.dart';
import '../../../lib/data/users_mock.dart';
import '../../../lib/utils/response_utils.dart';

/// /admin/users/:userId
/// GET - 獲取用戶詳情
/// PATCH - 更新用戶
Future<Response> onRequest(RequestContext context, String userId) async {
  switch (context.request.method) {
    case HttpMethod.get:
      return _getUser(context, userId);
    case HttpMethod.patch:
      return _updateUser(context, userId);
    default:
      return ResponseUtils.error(
        error: 'MethodNotAllowed',
        message: '只支援 GET、PATCH 請求',
        statusCode: 405,
      );
  }
}

/// GET /admin/users/:userId - 獲取用戶詳情
Future<Response> _getUser(RequestContext context, String userId) async {
  try {
    final user = getMockUserById(userId);

    if (user == null) {
      return ResponseUtils.notFound('用戶不存在');
    }

    return ResponseUtils.success(data: user);
  } catch (e) {
    return ResponseUtils.error(
      error: 'ServerError',
      message: '獲取用戶詳情失敗: $e',
      statusCode: 500,
    );
  }
}

/// PATCH /admin/users/:userId - 更新用戶
Future<Response> _updateUser(RequestContext context, String userId) async {
  try {
    final user = getMockUserById(userId);

    if (user == null) {
      return ResponseUtils.notFound('用戶不存在');
    }

    final body = await context.request.body();
    final data = jsonDecode(body) as Map<String, dynamic>;

    // 不允許修改 admin 的角色
    if (user['role'] == 'admin' &&
        data['role'] != null &&
        data['role'] != 'admin') {
      return ResponseUtils.validationError('無法變更系統管理員的角色');
    }

    // 允許更新的欄位
    final allowedFields = ['name', 'role', 'unit', 'email', 'status'];
    final updates = <String, dynamic>{};

    for (final field in allowedFields) {
      if (data.containsKey(field)) {
        updates[field] = data[field];
      }
    }

    if (updates.isEmpty) {
      return ResponseUtils.validationError('沒有可更新的欄位');
    }

    final updatedUser = updateMockUser(userId, updates);

    if (updatedUser == null) {
      return ResponseUtils.error(
        error: 'ServerError',
        message: '更新用戶失敗',
        statusCode: 500,
      );
    }

    return ResponseUtils.success(data: {
      'message': '用戶資料已更新',
      'user': updatedUser,
    });
  } catch (e) {
    return ResponseUtils.error(
      error: 'ServerError',
      message: '更新用戶失敗: $e',
      statusCode: 500,
    );
  }
}

