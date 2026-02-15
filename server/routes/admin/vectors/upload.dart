import 'dart:convert';
import 'package:dart_frog/dart_frog.dart';
import '../../../lib/data/vectors_mock.dart';
import '../../../lib/utils/response_utils.dart';

/// POST /admin/vectors/upload - 上傳文件到向量資料庫
Future<Response> onRequest(RequestContext context) async {
  if (context.request.method != HttpMethod.post) {
    return ResponseUtils.error(
      error: 'MethodNotAllowed',
      message: '只支援 POST 請求',
      statusCode: 405,
    );
  }

  try {
    final body = await context.request.body();
    final data = jsonDecode(body) as Map<String, dynamic>;

    // 驗證必填欄位
    final databaseId = data['databaseId'] as String?;
    final fileName = data['fileName'] as String?;
    final fileSize = data['fileSize'] as int? ?? 0;

    if (databaseId == null || databaseId.isEmpty) {
      return ResponseUtils.validationError('請選擇目標資料庫');
    }

    if (fileName == null || fileName.isEmpty) {
      return ResponseUtils.validationError('請提供檔案名稱');
    }

    // 驗證資料庫存在
    final database = getMockVectorDatabaseById(databaseId);
    if (database == null) {
      return ResponseUtils.notFound('向量資料庫不存在');
    }

    // 模擬上傳並處理
    final updatedDatabase =
        uploadToVectorDatabase(databaseId, fileName, fileSize);

    if (updatedDatabase == null) {
      return ResponseUtils.error(
        error: 'ServerError',
        message: '上傳失敗',
        statusCode: 500,
      );
    }

    return ResponseUtils.success(data: {
      'message': '文件上傳成功並已嵌入向量資料庫',
      'fileName': fileName,
      'database': updatedDatabase,
    });
  } catch (e) {
    return ResponseUtils.error(
      error: 'ServerError',
      message: '上傳文件失敗: $e',
      statusCode: 500,
    );
  }
}

