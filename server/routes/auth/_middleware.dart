import 'package:dart_frog/dart_frog.dart';

/// Auth routes middleware - no authentication required for login/logout/refresh
Handler middleware(Handler handler) {
  return handler;
}

