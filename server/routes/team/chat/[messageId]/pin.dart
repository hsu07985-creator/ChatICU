import 'package:dart_frog/dart_frog.dart';
import '../../../../lib/services/data_service.dart';
import '../../../../lib/utils/response_utils.dart';

/// PATCH /team/chat/:messageId/pin - 釘選/取消釘選訊息
Future<Response> onRequest(
  RequestContext context,
  String messageId,
) async {
  if (context.request.method != HttpMethod.patch) {
    return ResponseUtils.error(
      error: 'MethodNotAllowed',
      message: '只支援 PATCH 方法',
      statusCode: 405,
    );
  }

  final user = context.read<Map<String, dynamic>>();
  final dataService = context.read<DataService>();

  // 取得訊息並切換釘選狀態
  final result = await dataService.toggleTeamChatMessagePin(
    messageId,
    user['id'] as String,
    user['name'] as String,
  );

  if (result == null) {
    return ResponseUtils.notFound('訊息不存在');
  }

  final isPinned = result['pinned'] as bool;

  return ResponseUtils.success(
    message: isPinned ? '訊息已釘選' : '已取消釘選',
    data: result,
  );
}

