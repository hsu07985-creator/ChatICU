import 'package:dart_frog/dart_frog.dart';
import '../../../../lib/services/data_service.dart';
import '../../../../lib/utils/response_utils.dart';

Future<Response> onRequest(RequestContext context, String id) async {
  if (context.request.method != HttpMethod.get) {
    return ResponseUtils.error(
      error: 'MethodNotAllowed',
      message: '只支援 GET 方法',
      statusCode: 405,
    );
  }

  final dataService = context.read<DataService>();

  // Verify patient exists
  final patient = await dataService.findPatientById(id);
  if (patient == null) {
    return ResponseUtils.notFound('病人不存在');
  }

  // 使用 DataService 的方法（自動處理 ID 格式轉換）
  final patientLabData = await dataService.getPatientLabData(id);

  if (patientLabData.isEmpty) {
    return ResponseUtils.notFound('無檢驗資料');
  }

  return ResponseUtils.success(data: patientLabData.first);
}

