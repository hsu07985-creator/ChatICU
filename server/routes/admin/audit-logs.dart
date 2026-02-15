import 'package:dart_frog/dart_frog.dart';
import '../../lib/data/audit_logs_mock.dart';
import '../../lib/utils/response_utils.dart';

/// GET /admin/audit-logs - 獲取稽核日誌
Future<Response> onRequest(RequestContext context) async {
  if (context.request.method != HttpMethod.get) {
    return ResponseUtils.error(
      error: 'MethodNotAllowed',
      message: '只支援 GET 請求',
      statusCode: 405,
    );
  }

  try {
    final queryParams = context.request.uri.queryParameters;

    // 分頁參數
    final page = int.tryParse(queryParams['page'] ?? '1') ?? 1;
    final limit = int.tryParse(queryParams['limit'] ?? '20') ?? 20;

    // 篩選參數
    final actionFilter = queryParams['action'];
    final userFilter = queryParams['user'];
    final statusFilter = queryParams['status'];
    final startDate = queryParams['startDate'];
    final endDate = queryParams['endDate'];

    var logs = getMockAuditLogs();

    // 應用篩選
    if (actionFilter != null && actionFilter.isNotEmpty) {
      logs = logs
          .where((log) => (log['action'] as String).contains(actionFilter))
          .toList();
    }

    if (userFilter != null && userFilter.isNotEmpty) {
      logs = logs
          .where((log) => (log['user'] as String).contains(userFilter))
          .toList();
    }

    if (statusFilter != null && statusFilter.isNotEmpty) {
      logs = logs.where((log) => log['status'] == statusFilter).toList();
    }

    // 日期篩選
    if (startDate != null && startDate.isNotEmpty) {
      logs = logs
          .where((log) => (log['timestamp'] as String).compareTo(startDate) >= 0)
          .toList();
    }

    if (endDate != null && endDate.isNotEmpty) {
      logs = logs
          .where((log) => (log['timestamp'] as String).compareTo(endDate) <= 0)
          .toList();
    }

    // 計算統計
    final totalLogs = logs.length;
    final successCount = logs.where((l) => l['status'] == 'success').length;
    final failedCount = logs.where((l) => l['status'] == 'failed').length;

    // 分頁
    final startIndex = (page - 1) * limit;
    final endIndex = startIndex + limit;
    final paginatedLogs = logs.length > startIndex
        ? logs.sublist(
            startIndex,
            endIndex > logs.length ? logs.length : endIndex,
          )
        : <Map<String, dynamic>>[];

    return ResponseUtils.success(data: {
      'logs': paginatedLogs,
      'pagination': {
        'page': page,
        'limit': limit,
        'total': totalLogs,
        'totalPages': (totalLogs / limit).ceil(),
      },
      'stats': {
        'total': totalLogs,
        'success': successCount,
        'failed': failedCount,
      },
    });
  } catch (e) {
    return ResponseUtils.error(
      error: 'ServerError',
      message: '獲取稽核日誌失敗: $e',
      statusCode: 500,
    );
  }
}

