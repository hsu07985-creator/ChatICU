/// Application configuration
class Config {
  /// 預設 port - Dart Frog 預設使用 8080
  static const int port = 8080;
  static const String jwtSecret = 'chaticu-secret-key-2026';
  static const Duration jwtExpiresIn = Duration(hours: 24);
  static const Duration refreshExpiresIn = Duration(days: 7);
  static const List<String> corsOrigins = [
    'http://localhost:5173', // Vite dev server
    'http://localhost:3000', // Alternative dev port
    'http://localhost:8080', // Same origin
  ];
}

