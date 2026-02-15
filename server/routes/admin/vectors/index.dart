import 'package:dart_frog/dart_frog.dart';
import '../../../lib/data/vectors_mock.dart';
import '../../../lib/utils/response_utils.dart';

/// GET /admin/vectors - 獲取向量資料庫列表
Future<Response> onRequest(RequestContext context) async {
  if (context.request.method != HttpMethod.get) {
    return ResponseUtils.error(
      error: 'MethodNotAllowed',
      message: '只支援 GET 請求',
      statusCode: 405,
    );
  }

  try {
    final databases = getMockVectorDatabases();

    // 計算總統計
    var totalDocuments = 0;
    var totalSizeNum = 0;

    for (final db in databases) {
      totalDocuments += db['documentCount'] as int;
      // 解析 size 字串（如 "128 MB"）
      final sizeStr = db['size'] as String;
      final sizeNum = int.tryParse(sizeStr.split(' ')[0]) ?? 0;
      totalSizeNum += sizeNum;
    }

    return ResponseUtils.success(data: {
      'databases': databases,
      'stats': {
        'totalDatabases': databases.length,
        'totalDocuments': totalDocuments,
        'totalSize': '$totalSizeNum MB',
        'activeDatabases':
            databases.where((db) => db['status'] == 'active').length,
      },
    });
  } catch (e) {
    return ResponseUtils.error(
      error: 'ServerError',
      message: '獲取向量資料庫列表失敗: $e',
      statusCode: 500,
    );
  }
}

