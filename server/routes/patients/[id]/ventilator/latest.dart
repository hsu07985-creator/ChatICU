import 'package:dart_frog/dart_frog.dart';
import '../../../../lib/data/ventilator_mock.dart';
import '../../../../lib/utils/response_utils.dart';

/// GET /patients/:id/ventilator/latest
/// 獲取最新呼吸器設定
Future<Response> onRequest(RequestContext context, String id) async {
  if (context.request.method != HttpMethod.get) {
    return ResponseUtils.error(
      error: 'MethodNotAllowed',
      message: '只支援 GET 請求',
      statusCode: 405,
    );
  }

  try {
    final settings = getLatestVentilatorSettings(id);

    if (settings == null) {
      return ResponseUtils.notFound('找不到呼吸器設定資料');
    }

    return ResponseUtils.success(data: settings);
  } catch (e) {
    return ResponseUtils.error(
      error: 'ServerError',
      message: '獲取呼吸器設定失敗: $e',
      statusCode: 500,
    );
  }
}


