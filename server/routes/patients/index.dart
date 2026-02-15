import 'dart:convert';
import 'package:dart_frog/dart_frog.dart';
import '../../lib/services/data_service.dart';
import '../../lib/utils/response_utils.dart';

Future<Response> onRequest(RequestContext context) async {
  switch (context.request.method) {
    case HttpMethod.get:
      return _getPatients(context);
    case HttpMethod.post:
      return _createPatient(context);
    default:
      return ResponseUtils.error(
        error: 'MethodNotAllowed',
        message: '只支援 GET、POST 方法',
        statusCode: 405,
      );
  }
}

/// GET /patients - 獲取病人列表
Future<Response> _getPatients(RequestContext context) async {

  final dataService = context.read<DataService>();
  final params = context.request.uri.queryParameters;

  // Parse query parameters
  final page = int.tryParse(params['page'] ?? '1') ?? 1;
  final limit = int.tryParse(params['limit'] ?? '10') ?? 10;
  final search = params['search'];
  final intubated = params['intubated'];
  final criticalStatus = params['criticalStatus'];
  final department = params['department'];

  var patients = await dataService.getPatients();
  final medications = await dataService.getMedications();

  // Apply filters
  if (search != null && search.isNotEmpty) {
    final searchLower = search.toLowerCase();
    patients = patients.where((p) {
      final name = (p['name'] as String).toLowerCase();
      final bedNumber = (p['bedNumber'] as String).toLowerCase();
      final mrn = p['medicalRecordNumber'] as String;
      return name.contains(searchLower) ||
          bedNumber.contains(searchLower) ||
          mrn.contains(searchLower);
    }).toList();
  }

  if (intubated != null) {
    final isIntubated = intubated == 'true';
    patients = patients.where((p) => p['intubated'] == isIntubated).toList();
  }

  if (criticalStatus != null) {
    patients =
        patients.where((p) => p['criticalStatus'] == criticalStatus).toList();
  }

  if (department != null) {
    patients = patients.where((p) => p['department'] == department).toList();
  }

  // Add S/A/N medication summary
  patients = patients.map((p) {
    final patientMeds = medications
        .where((m) => m['patientId'] == p['id'] && m['status'] == 'active')
        .toList();
    return {
      ...p,
      'sanSummary': {
        'sedation': patientMeds
            .where((m) => m['sanCategory'] == 'S')
            .map((m) => m['name'])
            .toList(),
        'analgesia': patientMeds
            .where((m) => m['sanCategory'] == 'A')
            .map((m) => m['name'])
            .toList(),
        'nmb': patientMeds
            .where((m) => m['sanCategory'] == 'N')
            .map((m) => m['name'])
            .toList(),
      },
    };
  }).toList();

  // Pagination
  final total = patients.length;
  final totalPages = (total / limit).ceil();
  final offset = (page - 1) * limit;
  final paginatedPatients = patients.skip(offset).take(limit).toList();

  return ResponseUtils.success(
    data: {
      'patients': paginatedPatients,
      'pagination': {
        'page': page,
        'limit': limit,
        'total': total,
        'totalPages': totalPages,
      },
    },
  );
}

/// POST /patients - 新增病人
Future<Response> _createPatient(RequestContext context) async {
  try {
    final body = await context.request.body();
    final data = jsonDecode(body) as Map<String, dynamic>;

    // 驗證必填欄位
    final requiredFields = ['name', 'bedNumber', 'medicalRecordNumber', 'diagnosis'];
    for (final field in requiredFields) {
      if (data[field] == null || (data[field] as String).isEmpty) {
        return ResponseUtils.error(
          error: 'ValidationError',
          message: '$field 為必填欄位',
          statusCode: 400,
        );
      }
    }

    final now = DateTime.now().toIso8601String();
    final newPatient = {
      'id': 'P${DateTime.now().millisecondsSinceEpoch}',
      'name': data['name'],
      'bedNumber': data['bedNumber'],
      'medicalRecordNumber': data['medicalRecordNumber'],
      'age': data['age'] ?? 0,
      'gender': data['gender'] ?? '男',
      'diagnosis': data['diagnosis'],
      'intubated': data['intubated'] ?? false,
      'admissionDate': data['admissionDate'] ?? now.substring(0, 10),
      'icuAdmissionDate': data['icuAdmissionDate'] ?? now.substring(0, 10),
      'ventilatorDays': data['ventilatorDays'] ?? 0,
      'attendingPhysician': data['attendingPhysician'] ?? '',
      'department': data['department'] ?? 'ICU',
      'lastUpdate': now,
      'alerts': <String>[],
      'consentStatus': 'none',
      'hasDNR': false,
      'isIsolated': data['isIsolated'] ?? false,
      'criticalStatus': data['criticalStatus'] ?? 'stable',
      'status': 'active',
      'sedation': <String>[],
      'analgesia': <String>[],
      'nmb': <String>[],
    };

    // 注意：這是模擬實作，實際應該寫入資料庫
    return ResponseUtils.success(
      data: newPatient,
      message: '病人新增成功',
      statusCode: 201,
    );
  } catch (e) {
    return ResponseUtils.error(
      error: 'ServerError',
      message: '新增病人失敗: $e',
      statusCode: 500,
    );
  }
}

