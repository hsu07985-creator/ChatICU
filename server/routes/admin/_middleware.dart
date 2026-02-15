import 'package:dart_frog/dart_frog.dart';
import '../../lib/middleware/auth_middleware.dart';
import '../../lib/utils/response_utils.dart';

Handler middleware(Handler handler) {
  // 先執行 authMiddleware，再執行 _adminOnlyMiddleware
  // use() 的執行順序是從右到左，所以要倒過來寫
  return handler.use(_adminOnlyMiddleware()).use(authMiddleware());
}

/// 管理者專用 middleware - 只允許 admin 角色訪問
Middleware _adminOnlyMiddleware() {
  return (handler) {
    return (context) async {
      // 從 context 中取得認證的用戶資料（由 authMiddleware 提供）
      Map<String, dynamic>? user;
      try {
        user = context.read<Map<String, dynamic>>();
      } catch (e) {
        return ResponseUtils.forbidden('需要管理者權限');
      }

      final role = user['role'] as String?;
      if (role != 'admin') {
        return ResponseUtils.forbidden('只有系統管理員可以存取此功能');
      }

      return handler(context);
    };
  };
}

