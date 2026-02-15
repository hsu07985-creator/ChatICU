import 'dart:convert';
import 'package:dart_frog/dart_frog.dart';
import '../../../lib/services/data_service.dart';
import '../../../lib/utils/response_utils.dart';

Future<Response> onRequest(RequestContext context, String id) async {
  final dataService = context.read<DataService>();

  switch (context.request.method) {
    case HttpMethod.get:
      return _getPatient(dataService, id);
    case HttpMethod.patch:
      return _updatePatient(context, dataService, id);
    default:
      return ResponseUtils.error(
        error: 'MethodNotAllowed',
        message: '只支援 GET, PATCH 方法',
        statusCode: 405,
      );
  }
}

Future<Response> _getPatient(DataService dataService, String id) async {
  final patient = await dataService.findPatientById(id);

  if (patient == null) {
    return ResponseUtils.notFound('病人不存在');
  }

  // 使用 DataService 的方法（自動處理 ID 格式轉換）
  final patientMeds = await dataService.getPatientMedications(id);
  final activeMeds = patientMeds.where((m) => m['status'] == 'active').toList();

  final patientLabData = await dataService.getPatientLabData(id);
  final latestLabData = patientLabData.isNotEmpty ? patientLabData.first : null;

  final patientMessages = await dataService.getPatientMessages(id);
  final unreadMessages = patientMessages.where((m) => m['isRead'] == false).length;

  return ResponseUtils.success(
    data: {
      ...patient,
      'sanSummary': {
        'sedation': activeMeds.where((m) => m['sanCategory'] == 'S').toList(),
        'analgesia': activeMeds.where((m) => m['sanCategory'] == 'A').toList(),
        'nmb': activeMeds.where((m) => m['sanCategory'] == 'N').toList(),
      },
      'latestLabData': latestLabData,
      'unreadMessagesCount': unreadMessages,
      'totalMedications': activeMeds.length,
    },
  );
}

Future<Response> _updatePatient(
  RequestContext context,
  DataService dataService,
  String id,
) async {
  // Check role authorization
  final user = context.read<Map<String, dynamic>>();
  final role = user['role'] as String?;
  if (role != 'admin' && role != 'doctor' && role != 'nurse') {
    return ResponseUtils.forbidden('此操作需要 admin、doctor 或 nurse 權限');
  }

  final patient = await dataService.findPatientById(id);
  if (patient == null) {
    return ResponseUtils.notFound('病人不存在');
  }

  final body = await context.request.body();
  if (body.isEmpty) {
    return ResponseUtils.validationError('請求體不能為空');
  }

  final updates = jsonDecode(body) as Map<String, dynamic>;

  // Allowed fields to update
  const allowedUpdates = [
    'name',
    'bedNumber',
    'diagnosis',
    'intubated',
    'age',
    'gender',
    'attendingPhysician',
    'department',
    'codeStatus',
    'hasDNR',
    'isIsolated',
    'allergies',
    'alerts',
    'consentStatus',
    'criticalStatus',
  ];

  final filteredUpdates = <String, dynamic>{};
  for (final key in allowedUpdates) {
    if (updates.containsKey(key)) {
      filteredUpdates[key] = updates[key];
    }
  }

  // 持久化更新病人資料
  final updatedPatient = await dataService.updatePatient(id, filteredUpdates);

  return ResponseUtils.success(
    message: '病人資料更新成功',
    data: updatedPatient,
  );
}

