import 'package:dart_frog/dart_frog.dart';
import '../../../../lib/data/ventilator_mock.dart';
import '../../../../lib/services/data_service.dart';
import '../../../../lib/utils/response_utils.dart';

/// GET /patients/:id/ventilator/trends
/// 獲取呼吸器趨勢
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
    final itemsStr = queryParams['items'];
    final items = itemsStr?.split(',');

    final trends = getVentilatorTrends(id, items: items);

    // 添加 patientName 到回傳資料中
    trends['patientName'] = patient['name'];

    return ResponseUtils.success(data: trends);
  } catch (e) {
    return ResponseUtils.error(
      error: 'ServerError',
      message: '獲取呼吸器趨勢失敗: $e',
      statusCode: 500,
    );
  }
}


