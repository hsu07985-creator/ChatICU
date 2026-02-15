import 'dart:convert';
import 'package:dart_frog/dart_frog.dart';
import 'package:uuid/uuid.dart';
import '../../../../lib/services/data_service.dart';
import '../../../../lib/utils/response_utils.dart';

Future<Response> onRequest(RequestContext context, String id) async {
  final dataService = context.read<DataService>();

  switch (context.request.method) {
    case HttpMethod.get:
      return _getMessages(context, dataService, id);
    case HttpMethod.post:
      return _sendMessage(context, dataService, id);
    default:
      return ResponseUtils.error(
        error: 'MethodNotAllowed',
        message: '只支援 GET, POST 方法',
        statusCode: 405,
      );
  }
}

Future<Response> _getMessages(
  RequestContext context,
  DataService dataService,
  String id,
) async {
  final patient = await dataService.findPatientById(id);
  if (patient == null) {
    return ResponseUtils.notFound('病人不存在');
  }

  final params = context.request.uri.queryParameters;
  final type = params['type'];
  final unreadOnly = params['unreadOnly'] == 'true';

  // 使用 DataService 的方法（自動處理 ID 格式轉換）
  var messages = await dataService.getPatientMessages(id);

  // Filter by message type
  if (type != null) {
    messages = messages.where((m) => m['messageType'] == type).toList();
  }

  // Filter unread only
  if (unreadOnly) {
    messages = messages.where((m) => m['isRead'] == false).toList();
  }

  // Sort by timestamp (newest first)
  messages.sort((a, b) {
    final aTime = DateTime.parse(a['timestamp'] as String);
    final bTime = DateTime.parse(b['timestamp'] as String);
    return bTime.compareTo(aTime);
  });

  return ResponseUtils.success(
    data: {
      'patientId': id,
      'patientName': patient['name'],
      'messages': messages,
      'total': messages.length,
      'unreadCount': messages.where((m) => m['isRead'] == false).length,
    },
  );
}

Future<Response> _sendMessage(
  RequestContext context,
  DataService dataService,
  String id,
) async {
  final user = context.read<Map<String, dynamic>>();

  // 確認病人存在
  final patient = await dataService.findPatientById(id);
  if (patient == null) {
    return ResponseUtils.notFound('病人不存在');
  }

  final body = await context.request.body();
  if (body.isEmpty) {
    return ResponseUtils.validationError('請求體不能為空');
  }

  final json = jsonDecode(body) as Map<String, dynamic>;
  final content = json['content'] as String?;
  final messageType = json['messageType'] as String? ?? 'general';

  if (content == null || content.isEmpty) {
    return ResponseUtils.validationError('訊息內容為必填');
  }

  // Only pharmacist can send medication-advice
  if (messageType == 'medication-advice' && user['role'] != 'pharmacist') {
    return ResponseUtils.forbidden('只有藥師可以發送藥事建議');
  }

  // 將 patientId 標準化為 pat_xxx 格式
  final normalizedPatientId = id.startsWith('pat_') ? id : 'pat_${id.padLeft(3, '0')}';

  final newMessage = <String, dynamic>{
    'id': 'pmsg_${const Uuid().v4().substring(0, 8)}',
    'patientId': normalizedPatientId,
    'authorId': user['id'],
    'authorName': user['name'],
    'authorRole': user['role'],
    'messageType': messageType,
    'content': content,
    'timestamp': DateTime.now().toUtc().toIso8601String(),
    'isRead': false,
    'readBy': <Map<String, dynamic>>[],
  };

  // Add medication-related fields for pharmacist advice
  if (messageType == 'medication-advice') {
    newMessage['linkedMedication'] = json['linkedMedication'];
    newMessage['adviceCode'] = json['adviceCode'];
  }

  // 持久化保存留言到 JSON 檔案
  await dataService.addPatientMessage(newMessage);

  return ResponseUtils.success(
    message: '留言發送成功',
    data: newMessage,
    statusCode: 201,
  );
}

