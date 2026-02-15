import 'package:dart_frog/dart_frog.dart';

/// Response utility functions
class ResponseUtils {
  /// Success response
  static Response success({
    dynamic data,
    String? message,
    int statusCode = 200,
  }) {
    return Response.json(
      statusCode: statusCode,
      body: {
        'success': true,
        if (message != null) 'message': message,
        if (data != null) 'data': data,
      },
    );
  }

  /// Error response
  static Response error({
    required String error,
    required String message,
    int statusCode = 400,
  }) {
    return Response.json(
      statusCode: statusCode,
      body: {
        'error': error,
        'message': message,
      },
    );
  }

  /// Unauthorized response
  static Response unauthorized([String message = '需要登入才能存取此資源']) {
    return error(
      error: 'Unauthorized',
      message: message,
      statusCode: 401,
    );
  }

  /// Forbidden response
  static Response forbidden([String message = '沒有權限執行此操作']) {
    return error(
      error: 'Forbidden',
      message: message,
      statusCode: 403,
    );
  }

  /// Not found response
  static Response notFound([String message = '資源不存在']) {
    return error(
      error: 'NotFound',
      message: message,
      statusCode: 404,
    );
  }

  /// Validation error response
  static Response validationError(String message) {
    return error(
      error: 'ValidationError',
      message: message,
      statusCode: 400,
    );
  }
}

