import 'dart:convert';
import 'package:dart_frog/dart_frog.dart';
import 'package:uuid/uuid.dart';
import '../../../lib/services/data_service.dart';
import '../../../lib/utils/response_utils.dart';

Future<Response> onRequest(RequestContext context) async {
  final dataService = context.read<DataService>();

  switch (context.request.method) {
    case HttpMethod.get:
      return _getTeamChat(context, dataService);
    case HttpMethod.post:
      return _sendTeamChatMessage(context, dataService);
    default:
      return ResponseUtils.error(
        error: 'MethodNotAllowed',
        message: '只支援 GET, POST 方法',
        statusCode: 405,
      );
  }
}

Future<Response> _getTeamChat(
  RequestContext context,
  DataService dataService,
) async {
  final params = context.request.uri.queryParameters;
  final limit = int.tryParse(params['limit'] ?? '50') ?? 50;

  final messagesData = await dataService.getMessages();
  var messages = (messagesData['teamChatMessages'] as List)
      .cast<Map<String, dynamic>>()
      .toList();

  // Sort by timestamp (newest first)
  messages.sort((a, b) {
    final aTime = DateTime.parse(a['timestamp'] as String);
    final bTime = DateTime.parse(b['timestamp'] as String);
    return bTime.compareTo(aTime);
  });

  messages = messages.take(limit).toList();

  return ResponseUtils.success(
    data: {
      'messages': messages,
      'total': messages.length,
    },
  );
}

Future<Response> _sendTeamChatMessage(
  RequestContext context,
  DataService dataService,
) async {
  final user = context.read<Map<String, dynamic>>();

  final body = await context.request.body();
  if (body.isEmpty) {
    return ResponseUtils.validationError('請求體不能為空');
  }

  final json = jsonDecode(body) as Map<String, dynamic>;
  final content = json['content'] as String?;
  final pinned = json['pinned'] as bool? ?? false;

  if (content == null || content.isEmpty) {
    return ResponseUtils.validationError('訊息內容為必填');
  }

  final newMessage = <String, dynamic>{
    'id': 'tchat_${const Uuid().v4().substring(0, 8)}',
    'userId': user['id'],
    'userName': user['name'],
    'userRole': user['role'],
    'content': content,
    'timestamp': DateTime.now().toUtc().toIso8601String(),
    'pinned': pinned,
  };

  // 如果是釘選訊息，添加釘選資訊
  if (pinned) {
    newMessage['pinnedBy'] = {
      'userId': user['id'],
      'userName': user['name'],
    };
    newMessage['pinnedAt'] = DateTime.now().toUtc().toIso8601String();
  }

  // 持久化保存訊息到 JSON 檔案
  await dataService.addTeamChatMessage(newMessage);

  return ResponseUtils.success(
    message: pinned ? '公告已發布' : '訊息發送成功',
    data: newMessage,
    statusCode: 201,
  );
}

