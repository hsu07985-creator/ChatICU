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

/// 模擬生命徵象資料
final Map<String, List<Map<String, dynamic>>> _vitalSignsHistory = {
  'pat_001': [
    {'timestamp': '2026-01-10 08:00', 'temp': 37.2, 'hr': 88, 'sbp': 125, 'dbp': 78, 'rr': 18, 'spo2': 96},
    {'timestamp': '2026-01-10 04:00', 'temp': 37.5, 'hr': 92, 'sbp': 130, 'dbp': 82, 'rr': 20, 'spo2': 95},
    {'timestamp': '2026-01-10 00:00', 'temp': 38.1, 'hr': 98, 'sbp': 118, 'dbp': 72, 'rr': 22, 'spo2': 94},
    {'timestamp': '2026-01-09 20:00', 'temp': 38.5, 'hr': 105, 'sbp': 115, 'dbp': 70, 'rr': 24, 'spo2': 93},
    {'timestamp': '2026-01-09 16:00', 'temp': 37.8, 'hr': 95, 'sbp': 122, 'dbp': 76, 'rr': 20, 'spo2': 95},
  ],
  'pat_002': [
    {'timestamp': '2026-01-10 08:00', 'temp': 36.8, 'hr': 78, 'sbp': 95, 'dbp': 58, 'rr': 16, 'spo2': 98},
    {'timestamp': '2026-01-10 04:00', 'temp': 36.5, 'hr': 75, 'sbp': 92, 'dbp': 55, 'rr': 14, 'spo2': 99},
    {'timestamp': '2026-01-10 00:00', 'temp': 37.0, 'hr': 82, 'sbp': 88, 'dbp': 52, 'rr': 18, 'spo2': 97},
    {'timestamp': '2026-01-09 20:00', 'temp': 37.2, 'hr': 85, 'sbp': 90, 'dbp': 54, 'rr': 20, 'spo2': 96},
  ],
  'pat_003': [
    {'timestamp': '2026-01-10 08:00', 'temp': 37.0, 'hr': 72, 'sbp': 140, 'dbp': 90, 'rr': 18, 'spo2': 94},
    {'timestamp': '2026-01-10 04:00', 'temp': 36.9, 'hr': 70, 'sbp': 145, 'dbp': 92, 'rr': 16, 'spo2': 95},
    {'timestamp': '2026-01-10 00:00', 'temp': 37.1, 'hr': 74, 'sbp': 138, 'dbp': 88, 'rr': 18, 'spo2': 94},
  ],
  'pat_004': [
    {'timestamp': '2026-01-10 08:00', 'temp': 36.8, 'hr': 72, 'sbp': 118, 'dbp': 72, 'rr': 16, 'spo2': 98},
    {'timestamp': '2026-01-10 04:00', 'temp': 36.7, 'hr': 70, 'sbp': 120, 'dbp': 74, 'rr': 15, 'spo2': 99},
    {'timestamp': '2026-01-10 00:00', 'temp': 36.9, 'hr': 68, 'sbp': 115, 'dbp': 70, 'rr': 16, 'spo2': 98},
  ],
};

/// 參考範圍
final Map<String, Map<String, dynamic>> _referenceRanges = {
  'temperature': {'min': 36.0, 'max': 37.5, 'unit': '°C'},
  'heartRate': {'min': 60, 'max': 100, 'unit': 'bpm'},
  'bloodPressure': {'sbpMin': 90, 'sbpMax': 140, 'dbpMin': 60, 'dbpMax': 90, 'unit': 'mmHg'},
  'respiratoryRate': {'min': 12, 'max': 20, 'unit': 'rpm'},
  'spo2': {'min': 95, 'max': 100, 'unit': '%'},
};

bool _isAbnormal(String type, num value, {int? dbp}) {
  final range = _referenceRanges[type];
  if (range == null) return false;

  if (type == 'bloodPressure' && dbp != null) {
    final sbpMin = range['sbpMin'] as num;
    final sbpMax = range['sbpMax'] as num;
    final dbpMin = range['dbpMin'] as num;
    final dbpMax = range['dbpMax'] as num;
    return value < sbpMin || value > sbpMax || dbp < dbpMin || dbp > dbpMax;
  }
  final min = range['min'] as num;
  final max = range['max'] as num;
  return value < min || value > max;
}

/// 獲取最新生命徵象
/// 回傳格式符合前端 VitalSigns 類型定義
Map<String, dynamic>? getLatestVitalSigns(String patientId) {
  final normalizedId = _normalizePatientId(patientId);
  final history = _vitalSignsHistory[normalizedId];
  if (history == null || history.isEmpty) return null;

  final latest = history.first;

  final temp = latest['temp'] as num;
  final hr = latest['hr'] as num;
  final sbp = latest['sbp'] as num;
  final dbp = latest['dbp'] as int;
  final rr = latest['rr'] as num;
  final spo2 = latest['spo2'] as num;

  // 計算 MAP (Mean Arterial Pressure)
  final map = (dbp + (sbp - dbp) / 3).round();

  // 回傳符合前端期望的扁平格式
  return {
    'id': 'vs_${normalizedId}_latest',
    'patientId': patientId,
    'timestamp': latest['timestamp'],
    'heartRate': hr,
    'bloodPressure': {
      'systolic': sbp,
      'diastolic': dbp,
      'mean': map,
    },
    'respiratoryRate': rr,
    'spo2': spo2,
    'temperature': temp,
  };
}

/// 獲取生命徵象趨勢
Map<String, dynamic> getVitalSignsTrend(String patientId, {String? vitalSign}) {
  final normalizedId = _normalizePatientId(patientId);
  final history = _vitalSignsHistory[normalizedId] ?? [];

  // 映射 vitalSign 名稱到資料欄位
  final fieldMap = {
    'temperature': 'temp',
    'heartRate': 'hr',
    'respiratoryRate': 'rr',
    'spo2': 'spo2',
  };
  
  if (vitalSign == 'bloodPressure' || vitalSign == null) {
    // 血壓需要特別處理
    final bpData = history.map((h) {
      return <String, dynamic>{
        'timestamp': h['timestamp'],
        'systolic': h['sbp'],
        'diastolic': h['dbp'],
      };
    }).toList();

    if (vitalSign == 'bloodPressure') {
      return {
        'patientId': patientId,
        'vitalSign': 'bloodPressure',
        'unit': 'mmHg',
        'referenceRange': 'SBP: 90-140, DBP: 60-90',
        'data': bpData,
      };
    }
  }

  if (vitalSign != null && fieldMap.containsKey(vitalSign)) {
    final field = fieldMap[vitalSign]!;
    final range = _referenceRanges[vitalSign]!;

    final data = history.map((h) {
      return <String, dynamic>{
        'timestamp': h['timestamp'],
        'value': h[field],
      };
    }).toList();

    return {
      'patientId': patientId,
      'vitalSign': vitalSign,
      'unit': range['unit'],
      'referenceRange': '${range['min']}-${range['max']}',
      'data': data,
    };
  }

  // 返回所有趨勢
  final tempTrend = history.map((h) {
    return <String, dynamic>{'timestamp': h['timestamp'], 'value': h['temp']};
  }).toList();
  final hrTrend = history.map((h) {
    return <String, dynamic>{'timestamp': h['timestamp'], 'value': h['hr']};
  }).toList();
  final bpTrend = history.map((h) {
    return <String, dynamic>{
      'timestamp': h['timestamp'],
      'sbp': h['sbp'],
      'dbp': h['dbp'],
    };
  }).toList();
  final rrTrend = history.map((h) {
    return <String, dynamic>{'timestamp': h['timestamp'], 'value': h['rr']};
  }).toList();
  final spo2Trend = history.map((h) {
    return <String, dynamic>{'timestamp': h['timestamp'], 'value': h['spo2']};
  }).toList();

  return {
    'patientId': patientId,
    'trends': {
      'temperature': tempTrend,
      'heartRate': hrTrend,
      'bloodPressure': bpTrend,
      'respiratoryRate': rrTrend,
      'spo2': spo2Trend,
    },
  };
}

