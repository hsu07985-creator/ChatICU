import 'package:dart_frog/dart_frog.dart';
import '../../../../lib/data/vital_signs_mock.dart';
import '../../../../lib/services/data_service.dart';
import '../../../../lib/utils/response_utils.dart';

/// GET /patients/:id/vital-signs/trends
/// 獲取生命徵象趨勢
Future<Response> onRequest(RequestContext context, String id) async {
  if (context.request.method != HttpMethod.get) {
    return ResponseUtils.error(
      error: 'MethodNotAllowed',
      message: '只支援 GET 請求',
      statusCode: 405,
    );
  }

  try {
    final dataService = context.read<DataService>();

    // 取得病人名稱
    final patient = await dataService.findPatientById(id);
    if (patient == null) {
      return ResponseUtils.notFound('病人不存在');
    }

    final queryParams = context.request.uri.queryParameters;
    final vitalSign = queryParams['vitalSign'];

    final trends = getVitalSignsTrend(id, vitalSign: vitalSign);

    // 添加 patientName 到回傳資料中
    trends['patientName'] = patient['name'];

    return ResponseUtils.success(data: trends);
  } catch (e) {
    return ResponseUtils.error(
      error: 'ServerError',
      message: '獲取生命徵象趨勢失敗: $e',
      statusCode: 500,
    );
  }
}


