import 'dart:convert';
import 'package:dart_frog/dart_frog.dart';
import '../../../lib/data/users_mock.dart';
import '../../../lib/utils/response_utils.dart';

/// /admin/users
/// GET - 獲取用戶列表
/// POST - 新增用戶
Future<Response> onRequest(RequestContext context) async {
  switch (context.request.method) {
    case HttpMethod.get:
      return _getUsers(context);
    case HttpMethod.post:
      return _createUser(context);
    default:
      return ResponseUtils.error(
        error: 'MethodNotAllowed',
        message: '只支援 GET、POST 請求',
        statusCode: 405,
      );
  }
}

/// GET /admin/users - 獲取用戶列表
Future<Response> _getUsers(RequestContext context) async {
  try {
    final queryParams = context.request.uri.queryParameters;

    final roleFilter = queryParams['role'];
    final statusFilter = queryParams['status'];
    final searchTerm = queryParams['search'];

    var users = getMockUsers();

    // 應用篩選
    if (roleFilter != null && roleFilter.isNotEmpty) {
      users = users.where((u) => u['role'] == roleFilter).toList();
    }

    if (statusFilter != null && statusFilter.isNotEmpty) {
      users = users.where((u) => u['status'] == statusFilter).toList();
    }

    if (searchTerm != null && searchTerm.isNotEmpty) {
      final term = searchTerm.toLowerCase();
      users = users
          .where(
            (u) =>
                (u['name'] as String).toLowerCase().contains(term) ||
                (u['username'] as String).toLowerCase().contains(term) ||
                (u['email'] as String).toLowerCase().contains(term) ||
                (u['unit'] as String).toLowerCase().contains(term),
          )
          .toList();
    }

    // 計算統計
    final allUsers = getMockUsers();
    final stats = {
      'total': allUsers.length,
      'active': allUsers.where((u) => u['status'] == 'active').length,
      'inactive': allUsers.where((u) => u['status'] == 'inactive').length,
      'locked': allUsers.where((u) => u['status'] == 'locked').length,
      'byRole': {
        'admin': allUsers.where((u) => u['role'] == 'admin').length,
        'doctor': allUsers.where((u) => u['role'] == 'doctor').length,
        'nurse': allUsers.where((u) => u['role'] == 'nurse').length,
        'pharmacist': allUsers.where((u) => u['role'] == 'pharmacist').length,
      },
    };

    return ResponseUtils.success(data: {
      'users': users,
      'stats': stats,
    });
  } catch (e) {
    return ResponseUtils.error(
      error: 'ServerError',
      message: '獲取用戶列表失敗: $e',
      statusCode: 500,
    );
  }
}

/// POST /admin/users - 新增用戶
Future<Response> _createUser(RequestContext context) async {
  try {
    final body = await context.request.body();
    final data = jsonDecode(body) as Map<String, dynamic>;

    // 驗證必填欄位
    if (data['username'] == null || (data['username'] as String).isEmpty) {
      return ResponseUtils.validationError('帳號為必填欄位');
    }
    if (data['name'] == null || (data['name'] as String).isEmpty) {
      return ResponseUtils.validationError('姓名為必填欄位');
    }
    if (data['password'] == null || (data['password'] as String).isEmpty) {
      return ResponseUtils.validationError('密碼為必填欄位');
    }

    // 檢查帳號是否已存在
    final existingUsers = getMockUsers();
    final usernameExists = existingUsers.any(
      (u) => u['username'] == data['username'],
    );
    if (usernameExists) {
      return ResponseUtils.validationError('帳號已存在');
    }

    // 新增用戶（同時寫入 JSON 檔案）
    final newUser = await addMockUser(data);

    return ResponseUtils.success(
      data: {
        'message': '帳號建立成功',
        'user': newUser,
      },
      statusCode: 201,
    );
  } catch (e) {
    return ResponseUtils.error(
      error: 'ServerError',
      message: '新增用戶失敗: $e',
      statusCode: 500,
    );
  }
}

