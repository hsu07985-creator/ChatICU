import 'dart:convert';
import 'package:dart_frog/dart_frog.dart';
import '../../lib/models/user.dart';
import '../../lib/services/data_service.dart';
import '../../lib/utils/jwt_utils.dart';
import '../../lib/utils/response_utils.dart';

Future<Response> onRequest(RequestContext context) async {
  if (context.request.method != HttpMethod.post) {
    return ResponseUtils.error(
      error: 'MethodNotAllowed',
      message: '只支援 POST 方法',
      statusCode: 405,
    );
  }

  final body = await context.request.body();
  if (body.isEmpty) {
    return ResponseUtils.validationError('請求體不能為空');
  }

  final json = jsonDecode(body) as Map<String, dynamic>;
  final refreshToken = json['refreshToken'] as String?;

  if (refreshToken == null) {
    return ResponseUtils.validationError('Refresh token 為必填');
  }

  final decoded = JwtUtils.verifyRefreshToken(refreshToken);
  if (decoded == null) {
    return ResponseUtils.error(
      error: 'InvalidRefreshToken',
      message: '無效的 Refresh Token',
      statusCode: 401,
    );
  }

  final dataService = context.read<DataService>();
  final userData = await dataService.findUserById(decoded['id'] as String);

  if (userData == null) {
    return ResponseUtils.error(
      error: 'UserNotFound',
      message: '用戶不存在',
      statusCode: 401,
    );
  }

  final user = User.fromJson(userData);
  final newToken = JwtUtils.generateToken(user);
  final newRefreshToken = JwtUtils.generateRefreshToken(user);

  return ResponseUtils.success(
    data: {
      'token': newToken,
      'refreshToken': newRefreshToken,
      'expiresIn': '24h',
    },
  );
}

