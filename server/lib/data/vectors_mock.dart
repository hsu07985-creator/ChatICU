/// 模擬向量資料庫資料
final List<Map<String, dynamic>> _mockVectorDatabases = [
  {
    'id': 'clinical-guidelines',
    'name': '臨床治療指引',
    'description': '包含 ICU 臨床治療指引、重症醫學指南等文件',
    'documentCount': 245,
    'lastUpdated': '2025-11-14 10:30:00',
    'status': 'active',
    'size': '128 MB',
  },
  {
    'id': 'medication-database',
    'name': '藥物資訊資料庫',
    'description': '藥物交互作用、劑量建議、用藥安全資訊',
    'documentCount': 1850,
    'lastUpdated': '2025-11-13 15:20:00',
    'status': 'active',
    'size': '456 MB',
  },
  {
    'id': 'nursing-protocols',
    'name': '護理作業準則',
    'description': '護理標準作業流程、照護規範',
    'documentCount': 89,
    'lastUpdated': '2025-11-12 09:15:00',
    'status': 'active',
    'size': '45 MB',
  },
  {
    'id': 'emergency-protocols',
    'name': '緊急處置流程',
    'description': '急救流程、緊急狀況處理指引',
    'documentCount': 67,
    'lastUpdated': '2025-11-10 14:45:00',
    'status': 'active',
    'size': '32 MB',
  },
];

/// 獲取所有向量資料庫
List<Map<String, dynamic>> getMockVectorDatabases() {
  return List<Map<String, dynamic>>.from(
    _mockVectorDatabases.map((db) => Map<String, dynamic>.from(db)),
  );
}

/// 根據 ID 獲取向量資料庫
Map<String, dynamic>? getMockVectorDatabaseById(String id) {
  try {
    return _mockVectorDatabases.firstWhere((db) => db['id'] == id);
  } catch (_) {
    return null;
  }
}

/// 模擬上傳文件到向量資料庫
Map<String, dynamic>? uploadToVectorDatabase(
  String databaseId,
  String fileName,
  int fileSize,
) {
  final index = _mockVectorDatabases.indexWhere((db) => db['id'] == databaseId);
  if (index == -1) return null;
  
  final now = DateTime.now().toString().substring(0, 19);
  _mockVectorDatabases[index]['documentCount'] = 
      (_mockVectorDatabases[index]['documentCount'] as int) + 1;
  _mockVectorDatabases[index]['lastUpdated'] = now;
  
  return Map<String, dynamic>.from(_mockVectorDatabases[index]);
}

/// 模擬重建向量索引
Map<String, dynamic>? rebuildVectorIndex(String databaseId) {
  final index = _mockVectorDatabases.indexWhere((db) => db['id'] == databaseId);
  if (index == -1) return null;
  
  final now = DateTime.now().toString().substring(0, 19);
  _mockVectorDatabases[index]['lastUpdated'] = now;
  _mockVectorDatabases[index]['status'] = 'active';
  
  return Map<String, dynamic>.from(_mockVectorDatabases[index]);
}

