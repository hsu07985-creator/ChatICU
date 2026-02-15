import 'dart:convert';
import 'package:dart_frog/dart_frog.dart';
import 'package:uuid/uuid.dart';
import '../../../../../lib/utils/response_utils.dart';

Future<Response> onRequest(
  RequestContext context,
  String id,
  String labDataId,
) async {
  if (context.request.method != HttpMethod.patch) {
    return ResponseUtils.error(
      error: 'MethodNotAllowed',
      message: '只支援 PATCH 方法',
      statusCode: 405,
    );
  }

  // Check role authorization
  final user = context.read<Map<String, dynamic>>();
  final role = user['role'] as String?;
  if (role != 'admin' && role != 'doctor') {
    return ResponseUtils.forbidden('此操作需要 admin 或 doctor 權限');
  }

  final body = await context.request.body();
  if (body.isEmpty) {
    return ResponseUtils.validationError('請求體不能為空');
  }

  final json = jsonDecode(body) as Map<String, dynamic>;
  final category = json['category'] as String?;
  final item = json['item'] as String?;
  final correctedValue = json['correctedValue'];
  final reason = json['reason'] as String?;

  if (category == null ||
      item == null ||
      correctedValue == null ||
      reason == null) {
    return ResponseUtils.validationError(
      '缺少必要欄位：category, item, correctedValue, reason',
    );
  }

  final correction = {
    'id': const Uuid().v4(),
    'labDataId': labDataId,
    'patientId': id,
    'category': category,
    'item': item,
    'correctedValue': correctedValue,
    'reason': reason,
    'correctedBy': {
      'id': user['id'],
      'name': user['name'],
      'role': user['role'],
    },
    'correctedAt': DateTime.now().toUtc().toIso8601String(),
  };

  return ResponseUtils.success(
    message: '檢驗數據校正成功',
    data: correction,
  );
}

