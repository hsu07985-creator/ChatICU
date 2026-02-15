import 'package:dart_frog/dart_frog.dart';
import '../../../../lib/data/vectors_mock.dart';
import '../../../../lib/utils/response_utils.dart';

/// POST /admin/vectors/:databaseId/rebuild - 重建向量索引
Future<Response> onRequest(RequestContext context, String databaseId) async {
  if (context.request.method != HttpMethod.post) {
    return ResponseUtils.error(
      error: 'MethodNotAllowed',
      message: '只支援 POST 請求',
      statusCode: 405,
    );
  }

  try {
    final database = getMockVectorDatabaseById(databaseId);

    if (database == null) {
      return ResponseUtils.notFound('向量資料庫不存在');
    }

    // 模擬重建索引
    final updatedDatabase = rebuildVectorIndex(databaseId);

    if (updatedDatabase == null) {
      return ResponseUtils.error(
        error: 'ServerError',
        message: '重建索引失敗',
        statusCode: 500,
      );
    }

    return ResponseUtils.success(data: {
      'message': '向量索引重建完成',
      'database': updatedDatabase,
    });
  } catch (e) {
    return ResponseUtils.error(
      error: 'ServerError',
      message: '重建向量索引失敗: $e',
      statusCode: 500,
    );
  }
}

