import 'dart:convert';
import 'package:dart_frog/dart_frog.dart';
import '../../../../../lib/utils/response_utils.dart';

Future<Response> onRequest(
  RequestContext context,
  String id,
  String medicationId,
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
  if (role != 'doctor' && role != 'pharmacist') {
    return ResponseUtils.forbidden('此操作需要 doctor 或 pharmacist 權限');
  }

  final body = await context.request.body();
  if (body.isEmpty) {
    return ResponseUtils.validationError('請求體不能為空');
  }

  final updates = jsonDecode(body) as Map<String, dynamic>;

  // Allowed fields to update
  const allowedUpdates = [
    'dose',
    'unit',
    'frequency',
    'status',
    'endDate',
    'warnings',
    'indication',
  ];

  final filteredUpdates = <String, dynamic>{};
  for (final key in allowedUpdates) {
    if (updates.containsKey(key)) {
      filteredUpdates[key] = updates[key];
    }
  }

  return ResponseUtils.success(
    message: '處方更新成功',
    data: {
      'id': medicationId,
      'patientId': id,
      ...filteredUpdates,
      'updatedBy': {
        'id': user['id'],
        'name': user['name'],
      },
      'updatedAt': DateTime.now().toUtc().toIso8601String(),
    },
  );
}

