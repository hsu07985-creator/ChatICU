import 'dart:convert';
import 'package:dart_frog/dart_frog.dart';
import '../../../lib/data/error_reports_mock.dart';
import '../../../lib/utils/response_utils.dart';

/// /pharmacy/error-reports
/// GET - 獲取錯誤回報列表
/// POST - 新增錯誤回報
Future<Response> onRequest(RequestContext context) async {
  switch (context.request.method) {
    case HttpMethod.get:
      return _getReports(context);
    case HttpMethod.post:
      return _createReport(context);
    default:
      return ResponseUtils.error(
        error: 'MethodNotAllowed',
        message: '只支援 GET、POST 請求',
        statusCode: 405,
      );
  }
}

/// GET /pharmacy/error-reports - 獲取錯誤回報列表
Future<Response> _getReports(RequestContext context) async {
  try {
    final queryParams = context.request.uri.queryParameters;

    final statusFilter = queryParams['status'];
    final typeFilter = queryParams['type'];
    final page = int.tryParse(queryParams['page'] ?? '') ?? 1;
    final limit = int.tryParse(queryParams['limit'] ?? '') ?? 10;

    var reports = getMockErrorReports();

    // 應用篩選
    if (statusFilter != null && statusFilter.isNotEmpty) {
      reports = reports.where((r) => r['status'] == statusFilter).toList();
    }

    if (typeFilter != null && typeFilter.isNotEmpty) {
      reports = reports.where((r) => r['errorType'] == typeFilter).toList();
    }

    // 分頁
    final total = reports.length;
    final startIdx = (page - 1) * limit;
    final endIdx = startIdx + limit > total ? total : startIdx + limit;
    final pagedReports = startIdx < total
        ? reports.sublist(startIdx, endIdx)
        : <Map<String, dynamic>>[];

    return ResponseUtils.success(data: {
      'reports': pagedReports,
      'pagination': {
        'page': page,
        'limit': limit,
        'total': total,
        'totalPages': (total / limit).ceil(),
      },
      'stats': getErrorReportStats(),
    });
  } catch (e) {
    return ResponseUtils.error(
      error: 'ServerError',
      message: '獲取錯誤回報列表失敗: $e',
      statusCode: 500,
    );
  }
}

/// POST /pharmacy/error-reports - 新增錯誤回報
Future<Response> _createReport(RequestContext context) async {
  try {
    final body = await context.request.body();
    final data = jsonDecode(body) as Map<String, dynamic>;

    // 驗證必填欄位
    if (data['errorType'] == null || (data['errorType'] as String).isEmpty) {
      return ResponseUtils.validationError('錯誤類型為必填欄位');
    }
    if (data['drug'] == null || (data['drug'] as String).isEmpty) {
      return ResponseUtils.validationError('涉及藥品為必填欄位');
    }
    if (data['description'] == null ||
        (data['description'] as String).isEmpty) {
      return ResponseUtils.validationError('錯誤描述為必填欄位');
    }

    final newReport = addMockErrorReport(data);

    return ResponseUtils.success(
      data: {
        'message': '用藥錯誤回報已送出',
        'report': newReport,
      },
      statusCode: 201,
    );
  } catch (e) {
    return ResponseUtils.error(
      error: 'ServerError',
      message: '新增錯誤回報失敗: $e',
      statusCode: 500,
    );
  }
}

