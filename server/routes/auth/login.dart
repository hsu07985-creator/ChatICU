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
  final username = json['username'] as String?;
  final password = json['password'] as String?;

  if (username == null || password == null) {
    return ResponseUtils.validationError('用戶名和密碼為必填');
  }

  final dataService = context.read<DataService>();
  final userData = await dataService.findUser(username, password);

  if (userData == null) {
    return ResponseUtils.error(
      error: 'InvalidCredentials',
      message: '用戶名或密碼錯誤',
      statusCode: 401,
    );
  }

  final user = User.fromJson(userData);
  final token = JwtUtils.generateToken(user);
  final refreshToken = JwtUtils.generateRefreshToken(user);

  return ResponseUtils.success(
    message: '登入成功',
    data: {
      'user': user.toPublicJson(),
      'token': token,
      'refreshToken': refreshToken,
      'expiresIn': '24h',
    },
  );
}

