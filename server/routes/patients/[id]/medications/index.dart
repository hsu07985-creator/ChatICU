import 'dart:convert';
import 'package:dart_frog/dart_frog.dart';
import 'package:uuid/uuid.dart';
import '../../../../lib/services/data_service.dart';
import '../../../../lib/utils/response_utils.dart';

Future<Response> onRequest(RequestContext context, String id) async {
  final dataService = context.read<DataService>();

  switch (context.request.method) {
    case HttpMethod.get:
      return _getMedications(context, dataService, id);
    case HttpMethod.post:
      return _addMedication(context, dataService, id);
    default:
      return ResponseUtils.error(
        error: 'MethodNotAllowed',
        message: '只支援 GET, POST 方法',
        statusCode: 405,
      );
  }
}

Future<Response> _getMedications(
  RequestContext context,
  DataService dataService,
  String id,
) async {
  final patient = await dataService.findPatientById(id);
  if (patient == null) {
    return ResponseUtils.notFound('病人不存在');
  }

  final params = context.request.uri.queryParameters;
  final status = params['status'] ?? 'active';
  final sanCategory = params['sanCategory'];

  // 使用 DataService 的方法（自動處理 ID 格式轉換）
  var medications = await dataService.getPatientMedications(id);

  // Filter by status
  if (status != 'all') {
    medications = medications.where((m) => m['status'] == status).toList();
  }

  // Filter by S/A/N category
  if (sanCategory != null) {
    medications =
        medications.where((m) => m['sanCategory'] == sanCategory).toList();
  }

  // Group by S/A/N
  final grouped = {
    'sedation': medications.where((m) => m['sanCategory'] == 'S').toList(),
    'analgesia': medications.where((m) => m['sanCategory'] == 'A').toList(),
    'nmb': medications.where((m) => m['sanCategory'] == 'N').toList(),
    'other': medications.where((m) => m['sanCategory'] == null).toList(),
  };

  // Check for drug interactions
  final interactionsData = await dataService.getDrugInteractions();
  final interactions =
      (interactionsData['drugInteractions'] as List).cast<Map<String, dynamic>>();
  final activeDrugs = medications
      .where((m) => m['status'] == 'active')
      .map((m) => m['genericName'] ?? m['name'])
      .toList();

  final relevantInteractions = interactions.where((int) {
    return activeDrugs.contains(int['drug1']) ||
        activeDrugs.contains(int['drug2']);
  }).toList();

  return ResponseUtils.success(
    data: {
      'patientId': id,
      'patientName': patient['name'],
      'medications': medications,
      'grouped': grouped,
      'interactions': relevantInteractions,
      'total': medications.length,
    },
  );
}

Future<Response> _addMedication(
  RequestContext context,
  DataService dataService,
  String id,
) async {
  // Check role authorization
  final user = context.read<Map<String, dynamic>>();
  final role = user['role'] as String?;
  if (role != 'doctor') {
    return ResponseUtils.forbidden('此操作需要 doctor 權限');
  }

  final body = await context.request.body();
  if (body.isEmpty) {
    return ResponseUtils.validationError('請求體不能為空');
  }

  final json = jsonDecode(body) as Map<String, dynamic>;
  final name = json['name'] as String?;
  final dose = json['dose'] as String?;
  final unit = json['unit'] as String?;
  final frequency = json['frequency'] as String?;
  final route = json['route'] as String?;

  if (name == null ||
      dose == null ||
      unit == null ||
      frequency == null ||
      route == null) {
    return ResponseUtils.validationError(
      '缺少必要欄位：name, dose, unit, frequency, route',
    );
  }

  final sanCategory = json['sanCategory'] as String?;
  final categoryMap = {'S': 'sedative', 'A': 'analgesic', 'N': 'neuromuscular_blocker'};

  final newMedication = {
    'id': 'med_${const Uuid().v4().substring(0, 8)}',
    'patientId': id,
    'name': name,
    'genericName': json['genericName'] ?? name,
    'category': categoryMap[sanCategory] ?? 'other',
    'sanCategory': sanCategory,
    'dose': dose,
    'unit': unit,
    'frequency': frequency,
    'route': route,
    'prn': json['prn'] ?? false,
    'indication': json['indication'] ?? '',
    'startDate': DateTime.now().toUtc().toIso8601String().split('T')[0],
    'endDate': null,
    'status': 'active',
    'prescribedBy': {'id': user['id'], 'name': user['name']},
    'warnings': json['warnings'] ?? <String>[],
  };

  return ResponseUtils.success(
    message: '處方新增成功',
    data: newMedication,
    statusCode: 201,
  );
}

