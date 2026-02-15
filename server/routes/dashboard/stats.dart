import 'package:dart_frog/dart_frog.dart';
import '../../lib/services/data_service.dart';
import '../../lib/utils/response_utils.dart';

/// GET /dashboard/stats - 獲取儀表板統計數據
Future<Response> onRequest(RequestContext context) async {
  if (context.request.method != HttpMethod.get) {
    return ResponseUtils.error(
      error: 'MethodNotAllowed',
      message: '只支援 GET 請求',
      statusCode: 405,
    );
  }

  try {
    final dataService = context.read<DataService>();
    final patients = await dataService.getPatients();
    final medications = await dataService.getMedications();
    final messages = await dataService.getMessages();
    final patientMessages =
        (messages['patientMessages'] as List?)?.cast<Map<String, dynamic>>() ??
            [];

    // 計算統計數據
    final totalPatients = patients.length;
    final intubatedPatients =
        patients.where((p) => p['intubated'] == true).length;
    final intubatedBeds = patients
        .where((p) => p['intubated'] == true)
        .map((p) => p['bedNumber'])
        .toList()
      ..sort();

    // 計算警示數量
    var totalAlerts = 0;
    for (final patient in patients) {
      final alerts = patient['alerts'] as List<dynamic>? ?? [];
      totalAlerts += alerts.length;
    }

    // 計算使用 SAN 的病人數量
    var patientsWithSAN = 0;
    for (final patient in patients) {
      final sedation = patient['sedation'] as List<dynamic>? ?? [];
      final analgesia = patient['analgesia'] as List<dynamic>? ?? [];
      final nmb = patient['nmb'] as List<dynamic>? ?? [];
      if (sedation.isNotEmpty || analgesia.isNotEmpty || nmb.isNotEmpty) {
        patientsWithSAN++;
      }
    }

    // 用藥統計
    final activeMeds =
        medications.where((m) => m['status'] == 'active').length;
    final sedationMeds = medications
        .where((m) => m['sanCategory'] == 'S' && m['status'] == 'active')
        .length;
    final analgesiaMeds = medications
        .where((m) => m['sanCategory'] == 'A' && m['status'] == 'active')
        .length;
    final nmbMeds = medications
        .where((m) => m['sanCategory'] == 'N' && m['status'] == 'active')
        .length;

    // 今日訊息統計
    final now = DateTime.now();
    final todayStr =
        '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
    final todayMessages = patientMessages.where((m) {
      final timestamp = m['timestamp'] as String? ?? '';
      return timestamp.startsWith(todayStr);
    }).length;
    final unreadMessages =
        patientMessages.where((m) => m['isRead'] == false).length;

    return ResponseUtils.success(data: {
      'patients': {
        'total': totalPatients,
        'intubated': intubatedPatients,
        'intubatedBeds': intubatedBeds,
        'withSAN': patientsWithSAN,
      },
      'alerts': {
        'total': totalAlerts,
      },
      'medications': {
        'active': activeMeds,
        'sedation': sedationMeds,
        'analgesia': analgesiaMeds,
        'nmb': nmbMeds,
      },
      'messages': {
        'today': todayMessages,
        'unread': unreadMessages,
      },
      'timestamp': DateTime.now().toIso8601String(),
    });
  } catch (e) {
    return ResponseUtils.error(
      error: 'ServerError',
      message: '獲取統計數據失敗: $e',
      statusCode: 500,
    );
  }
}

