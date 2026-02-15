import 'package:dart_jsonwebtoken/dart_jsonwebtoken.dart';
import '../config.dart';
import '../models/user.dart';

/// JWT utility functions
class JwtUtils {
  /// Generate access token
  static String generateToken(User user) {
    final jwt = JWT(
      {
        'id': user.id,
        'username': user.username,
        'name': user.name,
        'role': user.role,
        'unit': user.unit,
      },
    );
    return jwt.sign(
      SecretKey(Config.jwtSecret),
      expiresIn: Config.jwtExpiresIn,
    );
  }

  /// Generate refresh token
  static String generateRefreshToken(User user) {
    final jwt = JWT(
      {
        'id': user.id,
        'type': 'refresh',
      },
    );
    return jwt.sign(
      SecretKey(Config.jwtSecret),
      expiresIn: Config.refreshExpiresIn,
    );
  }

  /// Verify token and return payload
  static Map<String, dynamic>? verifyToken(String token) {
    try {
      final jwt = JWT.verify(token, SecretKey(Config.jwtSecret));
      return jwt.payload as Map<String, dynamic>;
    } on JWTExpiredException {
      return null;
    } on JWTException {
      return null;
    }
  }

  /// Verify refresh token
  static Map<String, dynamic>? verifyRefreshToken(String token) {
    try {
      final jwt = JWT.verify(token, SecretKey(Config.jwtSecret));
      final payload = jwt.payload as Map<String, dynamic>;
      if (payload['type'] != 'refresh') return null;
      return payload;
    } catch (e) {
      return null;
    }
  }
}

