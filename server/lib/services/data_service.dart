import 'dart:convert';
import 'dart:io';

/// 將舊格式 ID 轉換為新格式
/// "1" -> "pat_001", "4" -> "pat_004"
String normalizePatientId(String id) {
  if (id.startsWith('pat_')) return id;
  final num = int.tryParse(id);
  if (num != null) {
    return 'pat_${num.toString().padLeft(3, '0')}';
  }
  return id;
}

/// Data service for loading mock data from JSON files
class DataService {
  static final DataService _instance = DataService._internal();
  factory DataService() => _instance;
  DataService._internal();

  Map<String, dynamic>? _users;
  Map<String, dynamic>? _patients;
  Map<String, dynamic>? _labData;
  Map<String, dynamic>? _labTrends;
  Map<String, dynamic>? _medications;
  Map<String, dynamic>? _messages;
  Map<String, dynamic>? _drugInteractions;

  String get _basePath => '../datamock';

  Future<Map<String, dynamic>> _loadJson(String filename) async {
    final file = File('$_basePath/$filename');
    final contents = await file.readAsString();
    return jsonDecode(contents) as Map<String, dynamic>;
  }

  /// 清除用戶快取，強制下次重新讀取
  void clearUsersCache() {
    _users = null;
  }

  Future<List<Map<String, dynamic>>> getUsers() async {
    // 每次都重新讀取 users.json 以確保獲取最新數據
    _users = await _loadJson('users.json');
    return (_users!['users'] as List).cast<Map<String, dynamic>>();
  }

  Future<List<Map<String, dynamic>>> getPatients() async {
    _patients ??= await _loadJson('patients.json');
    return (_patients!['patients'] as List).cast<Map<String, dynamic>>();
  }

  Future<List<Map<String, dynamic>>> getLabData() async {
    _labData ??= await _loadJson('labData.json');
    return (_labData!['labData'] as List).cast<Map<String, dynamic>>();
  }

  Future<Map<String, dynamic>> getLabTrends() async {
    _labTrends ??= await _loadJson('labTrends.json');
    return _labTrends!['labTrends'] as Map<String, dynamic>;
  }

  Future<List<Map<String, dynamic>>> getMedications() async {
    _medications ??= await _loadJson('medications.json');
    return (_medications!['medications'] as List).cast<Map<String, dynamic>>();
  }

  Future<Map<String, dynamic>> getMessages() async {
    // 每次都重新讀取 messages.json 以確保獲取最新數據
    _messages = await _loadJson('messages.json');
    return _messages!;
  }

  /// 添加新留言並持久化到 JSON 檔案
  Future<void> addPatientMessage(Map<String, dynamic> message) async {
    final messages = await getMessages();
    final patientMessages =
        (messages['patientMessages'] as List).cast<Map<String, dynamic>>();
    patientMessages.add(message);

    // 寫入檔案
    await _saveMessages(messages);
  }

  /// 添加團隊聊天訊息並持久化到 JSON 檔案
  Future<void> addTeamChatMessage(Map<String, dynamic> message) async {
    final messages = await getMessages();
    final teamChatMessages =
        (messages['teamChatMessages'] as List).cast<Map<String, dynamic>>();
    teamChatMessages.add(message);

    // 寫入檔案
    await _saveMessages(messages);
  }

  /// 保存訊息到 JSON 檔案
  Future<void> _saveMessages(Map<String, dynamic> messages) async {
    final file = File('$_basePath/messages.json');
    await file.writeAsString(
      const JsonEncoder.withIndent('  ').convert(messages),
    );

    // 清除快取
    _messages = null;
  }

  /// 取得團隊聊天訊息
  Future<List<Map<String, dynamic>>> getTeamChatMessages() async {
    final messages = await getMessages();
    return (messages['teamChatMessages'] as List).cast<Map<String, dynamic>>();
  }

  /// 切換團隊聊天訊息的釘選狀態
  Future<Map<String, dynamic>?> toggleTeamChatMessagePin(
    String messageId,
    String userId,
    String userName,
  ) async {
    final messages = await getMessages();
    final teamChatMessages =
        (messages['teamChatMessages'] as List).cast<Map<String, dynamic>>();

    // 找到訊息
    final index = teamChatMessages.indexWhere((m) => m['id'] == messageId);
    if (index == -1) {
      return null;
    }

    final message = teamChatMessages[index];
    final currentPinned = message['pinned'] as bool? ?? false;
    final newPinned = !currentPinned;

    // 更新訊息
    message['pinned'] = newPinned;
    if (newPinned) {
      message['pinnedBy'] = {
        'userId': userId,
        'userName': userName,
      };
      message['pinnedAt'] = DateTime.now().toUtc().toIso8601String();
    } else {
      message.remove('pinnedBy');
      message.remove('pinnedAt');
    }

    // 保存到檔案
    await _saveMessages(messages);

    return {
      'messageId': messageId,
      'pinned': newPinned,
      if (newPinned) 'pinnedBy': message['pinnedBy'],
      if (newPinned) 'pinnedAt': message['pinnedAt'],
    };
  }

  Future<Map<String, dynamic>> getDrugInteractions() async {
    _drugInteractions ??= await _loadJson('drugInteractions.json');
    return _drugInteractions!;
  }

  /// 更新病人資料並持久化
  Future<Map<String, dynamic>> updatePatient(
    String id,
    Map<String, dynamic> updates,
  ) async {
    final normalizedId = normalizePatientId(id);

    // 重新讀取最新資料
    _patients = await _loadJson('patients.json');
    final patients =
        (_patients!['patients'] as List).cast<Map<String, dynamic>>();

    // 找到病人
    final index = patients.indexWhere((p) => p['id'] == normalizedId);
    if (index == -1) {
      throw Exception('病人不存在');
    }

    // 更新資料
    final patient = patients[index];
    patient.addAll(updates);
    patient['lastUpdate'] = DateTime.now().toIso8601String().split('T')[0];

    // 寫入檔案
    final file = File('$_basePath/patients.json');
    await file.writeAsString(
      const JsonEncoder.withIndent('  ').convert(_patients),
    );

    // 清除快取
    _patients = null;

    return patient;
  }

  /// Find user by username and password
  Future<Map<String, dynamic>?> findUser(
    String username,
    String password,
  ) async {
    final users = await getUsers();
    try {
      return users.firstWhere(
        (u) =>
            u['username'] == username &&
            u['password'] == password &&
            u['active'] == true,
      );
    } catch (e) {
      return null;
    }
  }

  /// Find user by ID
  Future<Map<String, dynamic>?> findUserById(String id) async {
    final users = await getUsers();
    try {
      return users.firstWhere((u) => u['id'] == id);
    } catch (e) {
      return null;
    }
  }

  /// Find patient by ID (支援 "1" 和 "pat_001" 兩種格式)
  Future<Map<String, dynamic>?> findPatientById(String id) async {
    final normalizedId = normalizePatientId(id);
    final patients = await getPatients();
    try {
      return patients.firstWhere((p) => p['id'] == normalizedId);
    } catch (e) {
      return null;
    }
  }

  /// 獲取病人的檢驗數據 (支援 ID 格式轉換)
  Future<List<Map<String, dynamic>>> getPatientLabData(String patientId) async {
    final normalizedId = normalizePatientId(patientId);
    final labData = await getLabData();
    return labData.where((l) => l['patientId'] == normalizedId).toList();
  }

  /// 獲取病人的藥物 (支援 ID 格式轉換)
  Future<List<Map<String, dynamic>>> getPatientMedications(String patientId) async {
    final normalizedId = normalizePatientId(patientId);
    final medications = await getMedications();
    return medications.where((m) => m['patientId'] == normalizedId).toList();
  }

  /// 獲取病人的留言 (支援 ID 格式轉換)
  Future<List<Map<String, dynamic>>> getPatientMessages(String patientId) async {
    final normalizedId = normalizePatientId(patientId);
    final messages = await getMessages();
    final patientMessages =
        (messages['patientMessages'] as List).cast<Map<String, dynamic>>();
    return patientMessages.where((m) => m['patientId'] == normalizedId).toList();
  }
}

