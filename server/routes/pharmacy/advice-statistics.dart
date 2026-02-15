import 'package:dart_frog/dart_frog.dart';
import '../../lib/data/advice_statistics_mock.dart';
import '../../lib/utils/response_utils.dart';

/// /pharmacy/advice-statistics
/// GET - 獲取用藥建議統計
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
    final month = queryParams['month']; // 格式: 2026-01

    final statistics = getAdviceStatistics(month: month);

    return ResponseUtils.success(data: statistics);
  } catch (e) {
    return ResponseUtils.error(
      error: 'ServerError',
      message: '獲取建議統計失敗: $e',
      statusCode: 500,
    );
  }
}

