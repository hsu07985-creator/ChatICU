/// 將舊格式 ID 轉換為新格式
String _normalizePatientId(String id) {
  // 如果已經是 pat_xxx 格式，直接返回
  if (id.startsWith('pat_')) return id;
  // 將 "1" 轉換為 "pat_001"
  final num = int.tryParse(id);
  if (num != null) {
    return 'pat_${num.toString().padLeft(3, '0')}';
  }
  return id;
}

/// 模擬呼吸器資料
final Map<String, List<Map<String, dynamic>>> _ventilatorHistory = {
  'pat_001': [
    {
      'timestamp': '2026-01-10 08:00',
      'mode': 'SIMV-PC',
      'fio2': 45,
      'peep': 8,
      'tidalVolume': 450,
      'respiratoryRate': 18,
      'inspiratoryPressure': 18,
      'pressureSupport': 12,
      'ieRatio': '1:2',
      'pip': 25,
      'plateau': 22,
      'compliance': 35,
      'resistance': 12,
    },
    {
      'timestamp': '2026-01-10 04:00',
      'mode': 'SIMV-PC',
      'fio2': 50,
      'peep': 10,
      'tidalVolume': 420,
      'respiratoryRate': 20,
      'inspiratoryPressure': 20,
      'pressureSupport': 12,
      'ieRatio': '1:2',
      'pip': 28,
      'plateau': 24,
      'compliance': 32,
      'resistance': 14,
    },
    {
      'timestamp': '2026-01-09 20:00',
      'mode': 'AC-PC',
      'fio2': 60,
      'peep': 12,
      'tidalVolume': 400,
      'respiratoryRate': 22,
      'inspiratoryPressure': 22,
      'pressureSupport': 0,
      'ieRatio': '1:2.5',
      'pip': 32,
      'plateau': 28,
      'compliance': 28,
      'resistance': 16,
    },
  ],
  'pat_002': [
    {
      'timestamp': '2026-01-10 08:00',
      'mode': 'AC-VC',
      'fio2': 70,
      'peep': 14,
      'tidalVolume': 380,
      'respiratoryRate': 24,
      'inspiratoryPressure': null,
      'pressureSupport': 0,
      'ieRatio': '1:2',
      'pip': 35,
      'plateau': 30,
      'compliance': 25,
      'resistance': 18,
    },
  ],
  'pat_003': [
    {
      'timestamp': '2026-01-10 08:00',
      'mode': 'CPAP/PS',
      'fio2': 35,
      'peep': 5,
      'tidalVolume': 500,
      'respiratoryRate': 14,
      'inspiratoryPressure': null,
      'pressureSupport': 8,
      'ieRatio': '1:2',
      'pip': 15,
      'plateau': null,
      'compliance': 45,
      'resistance': 8,
    },
  ],
  // pat_004 沒有使用呼吸器（非插管病患）
};

/// 獲取最新呼吸器設定
/// 回傳格式符合前端 VentilatorSettings 類型定義
Map<String, dynamic>? getLatestVentilatorSettings(String patientId) {
  final normalizedId = _normalizePatientId(patientId);
  final history = _ventilatorHistory[normalizedId];
  if (history == null || history.isEmpty) return null;

  final latest = history.first;
  return {
    'id': 'vent_${normalizedId}_latest',
    'patientId': patientId,
    'timestamp': latest['timestamp'],
    'mode': latest['mode'],
    'fio2': latest['fio2'],
    'peep': latest['peep'],
    'tidalVolume': latest['tidalVolume'],
    'respiratoryRate': latest['respiratoryRate'],
    'inspiratoryPressure': latest['inspiratoryPressure'],
    'pressureSupport': latest['pressureSupport'],
    'ieRatio': latest['ieRatio'],
    'pip': latest['pip'],
    'plateau': latest['plateau'],
    'compliance': latest['compliance'],
    'resistance': latest['resistance'],
  };
}

/// 獲取呼吸器趨勢
Map<String, dynamic> getVentilatorTrends(String patientId, {List<String>? items}) {
  final normalizedId = _normalizePatientId(patientId);
  final history = _ventilatorHistory[normalizedId] ?? [];

  final trends = <String, List<Map<String, dynamic>>>{};
  final fields = items ?? ['fio2', 'peep', 'tidalVolume', 'compliance', 'pip'];

  for (final field in fields) {
    trends[field] = history.where((h) => h[field] != null).map((h) {
      return {'timestamp': h['timestamp'], 'value': h[field]};
    }).toList();
  }

  return {
    'patientId': patientId,
    'trends': trends,
  };
}

/// 獲取脫機評估
/// 回傳格式符合前端 WeaningAssessment 類型定義
Map<String, dynamic> getWeaningAssessment(String patientId) {
  final normalizedId = _normalizePatientId(patientId);
  // 模擬脫機評估資料
  return {
    'id': 'weaning_${normalizedId}_latest',
    'patientId': patientId,
    'timestamp': '2026-01-10 08:00',
    'rsbi': 65,
    'nif': -28,
    'vt': 450,
    'rr': 18,
    'spo2': 96,
    'fio2': 45,
    'peep': 8,
    'gcs': 11,
    'coughStrength': 'moderate',
    'secretions': 'minimal',
    'hemodynamicStability': true,
    'recommendation': '建議考慮進行自發性呼吸試驗 (SBT)',
    'readinessScore': 75,
    'assessedBy': {
      'id': '2',
      'name': '李穎灝',
      'role': 'doctor',
    },
  };
}

