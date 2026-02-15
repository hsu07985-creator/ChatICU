import 'package:dart_frog/dart_frog.dart';
import '../utils/jwt_utils.dart';
import '../utils/response_utils.dart';

/// Authentication middleware
Middleware authMiddleware() {
  return (handler) {
    return (context) async {
      final authHeader = context.request.headers['authorization'];

      if (authHeader == null || !authHeader.startsWith('Bearer ')) {
        return ResponseUtils.unauthorized();
      }

      final token = authHeader.substring(7);
      final payload = JwtUtils.verifyToken(token);

      if (payload == null) {
        return ResponseUtils.unauthorized('Token 已過期或無效');
      }

      // Add user info to request context
      final updatedContext = context.provide<Map<String, dynamic>>(
        () => payload,
      );

      return handler(updatedContext);
    };
  };
}

/// Role-based authorization middleware
Middleware authorizeRoles(List<String> allowedRoles) {
  return (handler) {
    return (context) async {
      final user = context.read<Map<String, dynamic>>();
      final role = user['role'] as String?;

      if (role == null || !allowedRoles.contains(role)) {
        return ResponseUtils.forbidden(
          '此操作需要 ${allowedRoles.join(" 或 ")} 權限',
        );
      }

      return handler(context);
    };
  };
}

