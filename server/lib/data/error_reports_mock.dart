/// 模擬用藥錯誤回報資料
List<Map<String, dynamic>> _mockErrorReports = [
  {
    'id': 'ERR-001',
    'date': '2025-01-08',
    'reportedAt': '2025-01-08 14:30:00',
    'errorType': '劑量錯誤',
    'drug': 'Morphine',
    'description': '誤開立 10mg，應為 4mg。病患體重 45kg，標準劑量應為 0.1mg/kg。',
    'patientId': 'P001',
    'status': 'resolved',
    'anonymous': false,
    'reporterId': '5',
    'reporterName': '陳雅婷',
    'actionTaken': '已通知主治醫師修正醫囑，劑量已調整為 4mg。',
    'resolvedAt': '2025-01-08 16:00:00',
    'resolvedBy': '李穎灝',
    'severity': 'moderate',
  },
  {
    'id': 'ERR-002',
    'date': '2025-01-07',
    'reportedAt': '2025-01-07 09:15:00',
    'errorType': '路徑錯誤',
    'drug': 'Insulin Glargine',
    'description': '醫囑標示 IM 注射，正確路徑應為 SC 皮下注射。',
    'patientId': 'P002',
    'status': 'resolved',
    'anonymous': true,
    'reporterId': null,
    'reporterName': null,
    'actionTaken': '已修正給藥路徑並更新醫囑系統提示。',
    'resolvedAt': '2025-01-07 11:30:00',
    'resolvedBy': '黃英哲',
    'severity': 'low',
  },
  {
    'id': 'ERR-003',
    'date': '2025-01-06',
    'reportedAt': '2025-01-06 16:45:00',
    'errorType': '重複給藥',
    'drug': 'Paracetamol',
    'description': '同時開立 PO Paracetamol 500mg 與 IV Paracetamol 1g，可能導致藥物過量。',
    'patientId': 'P003',
    'status': 'pending',
    'anonymous': false,
    'reporterId': '4',
    'reporterName': '王美玲',
    'actionTaken': null,
    'resolvedAt': null,
    'resolvedBy': null,
    'severity': 'high',
  },
  {
    'id': 'ERR-004',
    'date': '2025-01-05',
    'reportedAt': '2025-01-05 08:00:00',
    'errorType': '藥品辨識錯誤',
    'drug': 'Epinephrine',
    'description': '藥品標籤相似，誤拿 Epinephrine 1:1000 而非 1:10000。幸好在給藥前發現。',
    'patientId': null,
    'status': 'resolved',
    'anonymous': false,
    'reporterId': '5',
    'reporterName': '陳雅婷',
    'actionTaken': '已更換為正確藥品。建議藥局重新檢視高警訊藥品標籤區分方式。',
    'resolvedAt': '2025-01-05 10:00:00',
    'resolvedBy': '系統管理員',
    'severity': 'high',
  },
  {
    'id': 'ERR-005',
    'date': '2025-01-04',
    'reportedAt': '2025-01-04 20:30:00',
    'errorType': '頻次錯誤',
    'drug': 'Ceftriaxone',
    'description': '醫囑 Q8H，但 Ceftriaxone 標準頻次為 Q12H 或 Q24H。',
    'patientId': 'P001',
    'status': 'resolved',
    'anonymous': true,
    'reporterId': null,
    'reporterName': null,
    'actionTaken': '已確認適應症後調整為 Q12H。',
    'resolvedAt': '2025-01-04 22:00:00',
    'resolvedBy': '李穎灝',
    'severity': 'low',
  },
];

int _nextId = 6;

/// 獲取所有錯誤回報
List<Map<String, dynamic>> getMockErrorReports() {
  return List.from(_mockErrorReports);
}

/// 根據 ID 獲取錯誤回報
Map<String, dynamic>? getMockErrorReportById(String id) {
  try {
    return _mockErrorReports.firstWhere((r) => r['id'] == id);
  } catch (e) {
    return null;
  }
}

/// 新增錯誤回報
Map<String, dynamic> addMockErrorReport(Map<String, dynamic> data) {
  final now = DateTime.now();
  final newReport = {
    'id': 'ERR-${_nextId.toString().padLeft(3, '0')}',
    'date': '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}',
    'reportedAt': now.toIso8601String().replaceAll('T', ' ').substring(0, 19),
    'errorType': data['errorType'],
    'drug': data['drug'],
    'description': data['description'],
    'patientId': data['patientId'],
    'status': 'pending',
    'anonymous': data['anonymous'] ?? false,
    'reporterId': data['anonymous'] == true ? null : data['reporterId'],
    'reporterName': data['anonymous'] == true ? null : data['reporterName'],
    'actionTaken': data['actionTaken'],
    'resolvedAt': null,
    'resolvedBy': null,
    'severity': data['severity'] ?? 'moderate',
  };
  
  _nextId++;
  _mockErrorReports.insert(0, newReport);
  return newReport;
}

/// 更新錯誤回報
Map<String, dynamic>? updateMockErrorReport(String id, Map<String, dynamic> updates) {
  final index = _mockErrorReports.indexWhere((r) => r['id'] == id);
  if (index == -1) return null;
  
  final report = Map<String, dynamic>.from(_mockErrorReports[index]);
  updates.forEach((key, value) {
    report[key] = value;
  });
  
  _mockErrorReports[index] = report;
  return report;
}

/// 獲取統計資料
Map<String, dynamic> getErrorReportStats() {
  final pending = _mockErrorReports.where((r) => r['status'] == 'pending').length;
  final resolved = _mockErrorReports.where((r) => r['status'] == 'resolved').length;
  
  // 按類型統計
  final byType = <String, int>{};
  for (final report in _mockErrorReports) {
    final type = report['errorType'] as String;
    byType[type] = (byType[type] ?? 0) + 1;
  }
  
  // 按嚴重程度統計
  final bySeverity = <String, int>{};
  for (final report in _mockErrorReports) {
    final severity = report['severity'] as String? ?? 'unknown';
    bySeverity[severity] = (bySeverity[severity] ?? 0) + 1;
  }
  
  return {
    'total': _mockErrorReports.length,
    'pending': pending,
    'resolved': resolved,
    'byType': byType,
    'bySeverity': bySeverity,
  };
}

