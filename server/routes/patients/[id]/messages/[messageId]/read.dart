import 'package:dart_frog/dart_frog.dart';
import '../../../../../lib/utils/response_utils.dart';

Future<Response> onRequest(
  RequestContext context,
  String id,
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

  final readRecord = {
    'userId': user['id'],
    'userName': user['name'],
    'readAt': DateTime.now().toUtc().toIso8601String(),
  };

  return ResponseUtils.success(
    message: '已標記為已讀',
    data: {
      'messageId': messageId,
      'patientId': id,
      'isRead': true,
      'readBy': [readRecord],
    },
  );
}

