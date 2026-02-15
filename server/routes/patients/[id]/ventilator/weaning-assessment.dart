import 'package:dart_frog/dart_frog.dart';
import '../../../../lib/data/ventilator_mock.dart';
import '../../../../lib/utils/response_utils.dart';

/// GET /patients/:id/ventilator/weaning-assessment
/// 獲取脫機評估
Future<Response> onRequest(RequestContext context, String id) async {
  if (context.request.method != HttpMethod.get) {
    return ResponseUtils.error(
      error: 'MethodNotAllowed',
      message: '只支援 GET 請求',
      statusCode: 405,
    );
  }

  try {
    final assessment = getWeaningAssessment(id);

    return ResponseUtils.success(data: assessment);
  } catch (e) {
    return ResponseUtils.error(
      error: 'ServerError',
      message: '獲取脫機評估失敗: $e',
      statusCode: 500,
    );
  }
}


