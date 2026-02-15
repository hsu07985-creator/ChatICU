/// 模擬用藥建議記錄
final List<Map<String, dynamic>> _mockAdviceRecords = [
  {
    'id': 'adv-1',
    'patientId': '1',
    'patientName': '陳大明',
    'bedNumber': 'A-101',
    'adviceCode': '1-4',
    'adviceLabel': '用藥劑量/頻次問題',
    'category': '1. 建議處方',
    'content': '病患腎功能 eGFR 45 ml/min，建議 Vancomycin 劑量調整為 1g Q24H，並監測血中濃度。',
    'pharmacistId': '5',
    'pharmacistName': '陳雅婷',
    'timestamp': '2026-01-09 14:30',
    'linkedMedications': ['Vancomycin'],
    'accepted': true,
    'responseTime': '2小時',
  },
  {
    'id': 'adv-2',
    'patientId': '2',
    'patientName': '林小華',
    'bedNumber': 'A-102',
    'adviceCode': '1-9',
    'adviceLabel': '藥品交互作用',
    'category': '1. 建議處方',
    'content': 'Warfarin 與 Amiodarone 併用可能增加出血風險，建議密切監測 INR 值。',
    'pharmacistId': '5',
    'pharmacistName': '陳雅婷',
    'timestamp': '2026-01-09 10:15',
    'linkedMedications': ['Warfarin', 'Amiodarone'],
    'accepted': true,
    'responseTime': '1小時',
  },
  {
    'id': 'adv-3',
    'patientId': '3',
    'patientName': '張美玲',
    'bedNumber': 'A-103',
    'adviceCode': '2-1',
    'adviceLabel': '藥品給藥時間建議',
    'category': '2. 主動建議',
    'content': 'Metformin 建議於餐後服用以減少腸胃不適副作用。',
    'pharmacistId': '5',
    'pharmacistName': '陳雅婷',
    'timestamp': '2026-01-08 16:00',
    'linkedMedications': ['Metformin'],
    'accepted': false,
    'responseTime': null,
  },
  {
    'id': 'adv-4',
    'patientId': '1',
    'patientName': '陳大明',
    'bedNumber': 'A-101',
    'adviceCode': '3-1',
    'adviceLabel': 'TDM 建議',
    'category': '3. 建議監測',
    'content': '建議監測 Vancomycin trough level，目標值 15-20 mg/L。',
    'pharmacistId': '5',
    'pharmacistName': '陳雅婷',
    'timestamp': '2026-01-08 09:30',
    'linkedMedications': ['Vancomycin'],
    'accepted': true,
    'responseTime': '30分鐘',
  },
  {
    'id': 'adv-5',
    'patientId': '2',
    'patientName': '林小華',
    'bedNumber': 'A-102',
    'adviceCode': '4-1',
    'adviceLabel': '病患衛教',
    'category': '4. 用藥適從性',
    'content': '已向病患說明 Warfarin 用藥注意事項，包括飲食限制與出血徵兆觀察。',
    'pharmacistId': '5',
    'pharmacistName': '陳雅婷',
    'timestamp': '2026-01-07 14:00',
    'linkedMedications': ['Warfarin'],
    'accepted': true,
    'responseTime': '即時',
  },
];

/// 獲取所有建議記錄
List<Map<String, dynamic>> getMockAdviceRecords() {
  return List.from(_mockAdviceRecords);
}

/// 獲取統計資料
Map<String, dynamic> getAdviceStatistics({String? month}) {
  var records = getMockAdviceRecords();
  
  // 如果指定月份則篩選
  if (month != null && month.isNotEmpty) {
    records = records.where((r) {
      final timestamp = r['timestamp'] as String;
      return timestamp.startsWith(month);
    }).toList();
  }
  
  final total = records.length;
  final accepted = records.where((r) => r['accepted'] == true).length;
  final acceptanceRate = total > 0 ? (accepted / total * 100) : 0.0;
  
  // 按類別統計
  final byCategory = <String, Map<String, dynamic>>{};
  for (final record in records) {
    final category = record['category'] as String;
    if (!byCategory.containsKey(category)) {
      byCategory[category] = {'count': 0, 'accepted': 0};
    }
    byCategory[category]!['count'] = (byCategory[category]!['count'] as int) + 1;
    if (record['accepted'] == true) {
      byCategory[category]!['accepted'] = (byCategory[category]!['accepted'] as int) + 1;
    }
  }
  
  final byCategoryList = byCategory.entries.map((e) {
    final count = e.value['count'] as int;
    final acceptedCount = e.value['accepted'] as int;
    return {
      'category': e.key,
      'count': count,
      'accepted': acceptedCount,
      'rate': count > 0 ? (acceptedCount / count * 100).round() : 0,
    };
  }).toList();
  
  return {
    'summary': {
      'totalAdvices': total,
      'acceptedAdvices': accepted,
      'acceptanceRate': acceptanceRate.round(),
      'avgResponseTime': '1.5小時',
    },
    'byCategory': byCategoryList,
    'records': records,
  };
}

