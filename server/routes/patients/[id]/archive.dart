import 'dart:convert';
import 'package:dart_frog/dart_frog.dart';
import '../../../lib/services/data_service.dart';
import '../../../lib/utils/response_utils.dart';

/// PATCH /patients/:id/archive - 封存/取消封存病人
Future<Response> onRequest(RequestContext context, String id) async {
  if (context.request.method != HttpMethod.patch) {
    return ResponseUtils.error(
      error: 'MethodNotAllowed',
      message: '只支援 PATCH 方法',
      statusCode: 405,
    );
  }

  try {
    final dataService = context.read<DataService>();
    final patient = await dataService.findPatientById(id);

    if (patient == null) {
      return ResponseUtils.error(
        error: 'NotFound',
        message: '找不到指定的病人',
        statusCode: 404,
      );
    }

    final body = await context.request.body();
    final data = jsonDecode(body) as Map<String, dynamic>;
    
    // 獲取封存狀態，預設為 true（封存）
    final archived = data['archived'] as bool? ?? true;
    final archiveReason = data['reason'] as String? ?? '';
    final dischargeType = data['dischargeType'] as String? ?? 'transfer';
    
    final now = DateTime.now().toIso8601String();
    
    // 更新病人狀態
    final updatedPatient = {
      ...patient,
      'status': archived ? 'archived' : 'active',
      'archivedAt': archived ? now : null,
      'archiveReason': archived ? archiveReason : null,
      'dischargeType': archived ? dischargeType : null,
      'lastUpdate': now,
    };

    return ResponseUtils.success(
      data: updatedPatient,
      message: archived ? '病人已封存' : '病人已取消封存',
    );
  } catch (e) {
    return ResponseUtils.error(
      error: 'ServerError',
      message: '封存操作失敗: $e',
      statusCode: 500,
    );
  }
}

