import 'package:dart_frog/dart_frog.dart';
import '../../lib/services/data_service.dart';
import '../../lib/utils/jwt_utils.dart';
import '../../lib/utils/response_utils.dart';

Future<Response> onRequest(RequestContext context) async {
  if (context.request.method != HttpMethod.get) {
    return ResponseUtils.error(
      error: 'MethodNotAllowed',
      message: '只支援 GET 方法',
      statusCode: 405,
    );
  }

  // Manual auth check for this endpoint
  final authHeader = context.request.headers['authorization'];
  if (authHeader == null || !authHeader.startsWith('Bearer ')) {
    return ResponseUtils.unauthorized();
  }

  final token = authHeader.substring(7);
  final payload = JwtUtils.verifyToken(token);
  if (payload == null) {
    return ResponseUtils.unauthorized('Token 已過期或無效');
  }

  final dataService = context.read<DataService>();
  final userData = await dataService.findUserById(payload['id'] as String);

  if (userData == null) {
    return ResponseUtils.notFound('用戶不存在');
  }

  return ResponseUtils.success(
    data: {
      'id': userData['id'],
      'name': userData['name'],
      'username': userData['username'],
      'role': userData['role'],
      'unit': userData['unit'],
      'email': userData['email'],
      'lastLogin': userData['lastLogin'],
    },
  );
}

