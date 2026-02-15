import 'package:dart_frog/dart_frog.dart';
import '../config.dart';

/// CORS middleware
Middleware corsMiddleware() {
  return (handler) {
    return (context) async {
      final origin = context.request.headers['origin'];

      // Handle preflight requests
      if (context.request.method == HttpMethod.options) {
        return Response(
          statusCode: 204,
          headers: _getCorsHeaders(origin),
        );
      }

      final response = await handler(context);

      // Add CORS headers to response
      return response.copyWith(
        headers: {
          ...response.headers,
          ..._getCorsHeaders(origin),
        },
      );
    };
  };
}

Map<String, String> _getCorsHeaders(String? origin) {
  final allowedOrigin = Config.corsOrigins.contains(origin) ? origin : '*';
  return {
    'Access-Control-Allow-Origin': allowedOrigin ?? '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Origin, Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
}

