import 'dart:convert';
import 'package:dart_frog/dart_frog.dart';
import '../../../lib/data/error_reports_mock.dart';
import '../../../lib/utils/response_utils.dart';

/// /pharmacy/error-reports/:reportId
/// GET - 獲取單一錯誤回報
/// PATCH - 更新錯誤回報
Future<Response> onRequest(RequestContext context, String reportId) async {
  switch (context.request.method) {
    case HttpMethod.get:
      return _getReport(context, reportId);
    case HttpMethod.patch:
      return _updateReport(context, reportId);
    default:
      return ResponseUtils.error(
        error: 'MethodNotAllowed',
        message: '只支援 GET、PATCH 請求',
        statusCode: 405,
      );
  }
}

/// GET /pharmacy/error-reports/:reportId
Future<Response> _getReport(RequestContext context, String reportId) async {
  try {
    final report = getMockErrorReportById(reportId);

    if (report == null) {
      return ResponseUtils.notFound('錯誤回報不存在');
    }

    return ResponseUtils.success(data: report);
  } catch (e) {
    return ResponseUtils.error(
      error: 'ServerError',
      message: '獲取錯誤回報失敗: $e',
      statusCode: 500,
    );
  }
}

/// PATCH /pharmacy/error-reports/:reportId - 更新錯誤回報
Future<Response> _updateReport(RequestContext context, String reportId) async {
  try {
    final report = getMockErrorReportById(reportId);

    if (report == null) {
      return ResponseUtils.notFound('錯誤回報不存在');
    }

    final body = await context.request.body();
    final data = jsonDecode(body) as Map<String, dynamic>;

    // 允許更新的欄位
    final allowedFields = [
      'status',
      'actionTaken',
      'resolvedBy',
      'resolvedAt',
    ];
    final updates = <String, dynamic>{};

    for (final field in allowedFields) {
      if (data.containsKey(field)) {
        updates[field] = data[field];
      }
    }

    // 如果標記為已解決，自動填入解決時間
    if (data['status'] == 'resolved' && !updates.containsKey('resolvedAt')) {
      final now = DateTime.now();
      updates['resolvedAt'] =
          now.toIso8601String().replaceAll('T', ' ').substring(0, 19);
    }

    if (updates.isEmpty) {
      return ResponseUtils.validationError('沒有可更新的欄位');
    }

    final updatedReport = updateMockErrorReport(reportId, updates);

    if (updatedReport == null) {
      return ResponseUtils.error(
        error: 'ServerError',
        message: '更新錯誤回報失敗',
        statusCode: 500,
      );
    }

    return ResponseUtils.success(data: {
      'message': '錯誤回報已更新',
      'report': updatedReport,
    });
  } catch (e) {
    return ResponseUtils.error(
      error: 'ServerError',
      message: '更新錯誤回報失敗: $e',
      statusCode: 500,
    );
  }
}

