import 'dart:convert';
import 'dart:io';

/// 模擬用戶資料（用於用戶管理）
/// 注意：這是完整的用戶資料，包含管理資訊
final List<Map<String, dynamic>> _mockUsers = [
  {
    'id': '1',
    'username': 'admin',
    'name': '系統管理員',
    'role': 'admin',
    'unit': '行政管理部',
    'email': 'admin@hospital.com',
    'status': 'active',
    'lastLogin': '2025-11-15 09:30:00',
    'createdAt': '2025-01-01 00:00:00',
  },
  {
    'id': '2',
    'username': 'dr.lee',
    'name': '李穎灝',
    'role': 'doctor',
    'unit': '內科加護病房',
    'email': 'lee@hospital.com',
    'status': 'active',
    'lastLogin': '2025-11-15 08:15:00',
    'createdAt': '2025-01-15 00:00:00',
  },
  {
    'id': '3',
    'username': 'dr.huang',
    'name': '黃英哲',
    'role': 'doctor',
    'unit': '內科加護病房',
    'email': 'huang@hospital.com',
    'status': 'active',
    'lastLogin': '2025-11-14 22:45:00',
    'createdAt': '2025-01-15 00:00:00',
  },
  {
    'id': '4',
    'username': 'nurse.wang',
    'name': '王美玲',
    'role': 'nurse',
    'unit': '內科加護病房',
    'email': 'wang@hospital.com',
    'status': 'active',
    'lastLogin': '2025-11-15 07:00:00',
    'createdAt': '2025-02-01 00:00:00',
  },
  {
    'id': '5',
    'username': 'pharmacist.chen',
    'name': '陳雅婷',
    'role': 'pharmacist',
    'unit': '藥劑部',
    'email': 'chen@hospital.com',
    'status': 'active',
    'lastLogin': '2025-11-15 09:00:00',
    'createdAt': '2025-02-10 00:00:00',
  },
  {
    'id': '6',
    'username': 'nurse.liu',
    'name': '劉小華',
    'role': 'nurse',
    'unit': '內科加護病房',
    'email': 'liu@hospital.com',
    'status': 'inactive',
    'lastLogin': '2025-10-20 15:30:00',
    'createdAt': '2025-03-01 00:00:00',
  },
];

/// 獲取所有用戶
List<Map<String, dynamic>> getMockUsers() {
  return List<Map<String, dynamic>>.from(
    _mockUsers.map((u) => Map<String, dynamic>.from(u)),
  );
}

/// 根據 ID 獲取用戶
Map<String, dynamic>? getMockUserById(String id) {
  final users = getMockUsers();
  try {
    return users.firstWhere((u) => u['id'] == id);
  } catch (_) {
    return null;
  }
}

/// 新增用戶（模擬）- 同時寫入 JSON 檔案以支援登入
Future<Map<String, dynamic>> addMockUser(Map<String, dynamic> userData) async {
  final newId = 'usr_${(_mockUsers.length + 1).toString().padLeft(3, '0')}';
  final now = DateTime.now().toIso8601String();

  // 用於內部管理顯示的資料
  final newUserDisplay = {
    'id': newId,
    'username': userData['username'],
    'name': userData['name'],
    'role': userData['role'] ?? 'nurse',
    'unit': userData['unit'] ?? '',
    'email': userData['email'] ?? '',
    'status': 'active',
    'lastLogin': '-',
    'createdAt': now,
  };
  _mockUsers.add(newUserDisplay);

  // 寫入 JSON 檔案以支援登入
  await _addUserToJsonFile(userData, newId, now);

  return Map<String, dynamic>.from(newUserDisplay);
}

/// 將用戶寫入 datamock/users.json
Future<void> _addUserToJsonFile(
  Map<String, dynamic> userData,
  String newId,
  String now,
) async {
  try {
    final file = File('../datamock/users.json');
    final contents = await file.readAsString();
    final json = jsonDecode(contents) as Map<String, dynamic>;
    final users = (json['users'] as List).cast<Map<String, dynamic>>();

    final newUserJson = {
      'id': newId,
      'name': userData['name'],
      'username': userData['username'],
      'password': userData['password'], // 密碼也要儲存
      'email': userData['email'] ?? '',
      'role': userData['role'] ?? 'nurse',
      'unit': userData['unit'] ?? '',
      'active': true,
      'lastLogin': null,
      'createdAt': now,
    };

    users.add(newUserJson);
    json['users'] = users;

    await file.writeAsString(
      const JsonEncoder.withIndent('  ').convert(json),
    );
  } catch (e) {
    print('Warning: Failed to write user to JSON file: $e');
  }
}

/// 更新用戶（模擬）
Map<String, dynamic>? updateMockUser(String id, Map<String, dynamic> updates) {
  final index = _mockUsers.indexWhere((u) => u['id'] == id);
  if (index == -1) return null;
  
  _mockUsers[index] = {..._mockUsers[index], ...updates};
  return Map<String, dynamic>.from(_mockUsers[index]);
}

