import 'package:dart_frog/dart_frog.dart';
import '../../../../lib/data/vital_signs_mock.dart';
import '../../../../lib/utils/response_utils.dart';

/// GET /patients/:id/vital-signs/latest
/// 獲取病人最新生命徵象
Future<Response> onRequest(RequestContext context, String id) async {
  if (context.request.method != HttpMethod.get) {
    return ResponseUtils.error(
      error: 'MethodNotAllowed',
      message: '只支援 GET 請求',
      statusCode: 405,
    );
  }

  try {
    final vitals = getLatestVitalSigns(id);

    if (vitals == null) {
      return ResponseUtils.notFound('找不到生命徵象資料');
    }

    return ResponseUtils.success(data: vitals);
  } catch (e) {
    return ResponseUtils.error(
      error: 'ServerError',
      message: '獲取生命徵象失敗: $e',
      statusCode: 500,
    );
  }
}


