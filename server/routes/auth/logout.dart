import 'package:dart_frog/dart_frog.dart';
import '../../lib/utils/response_utils.dart';

Future<Response> onRequest(RequestContext context) async {
  if (context.request.method != HttpMethod.post) {
    return ResponseUtils.error(
      error: 'MethodNotAllowed',
      message: '只支援 POST 方法',
      statusCode: 405,
    );
  }

  // In a real implementation, we would invalidate the token
  return ResponseUtils.success(message: '登出成功');
}

