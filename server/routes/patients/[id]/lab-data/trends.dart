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
  final params = context.request.uri.queryParameters;

  // Verify patient exists
  final patient = await dataService.findPatientById(id);
  if (patient == null) {
    return ResponseUtils.notFound('病人不存在');
  }

  final labTrends = await dataService.getLabTrends();
  final patientTrends = labTrends[id] as Map<String, dynamic>?;

  if (patientTrends == null) {
    return ResponseUtils.success(data: <String, dynamic>{});
  }

  // Filter by requested items if specified
  final items = params['items'];
  var filteredTrends = Map<String, dynamic>.from(patientTrends);

  if (items != null && items.isNotEmpty) {
    final requestedItems = items.split(',');
    filteredTrends = <String, dynamic>{};
    for (final item in requestedItems) {
      if (patientTrends.containsKey(item)) {
        filteredTrends[item] = patientTrends[item];
      }
    }
  }

  // Filter by days if needed
  final days = int.tryParse(params['days'] ?? '7') ?? 7;
  final cutoffDate = DateTime.now().subtract(Duration(days: days));

  for (final key in filteredTrends.keys) {
    final trendList = filteredTrends[key] as List;
    filteredTrends[key] = trendList.where((item) {
      final timestamp = DateTime.parse(item['timestamp'] as String);
      return timestamp.isAfter(cutoffDate);
    }).toList();
  }

  return ResponseUtils.success(
    data: {
      'patientId': id,
      'patientName': patient['name'],
      'trends': filteredTrends,
    },
  );
}

