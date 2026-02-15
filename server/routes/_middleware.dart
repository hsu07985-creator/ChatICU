import 'package:dart_frog/dart_frog.dart';
import '../lib/middleware/cors_middleware.dart';
import '../lib/services/data_service.dart';

Handler middleware(Handler handler) {
  return handler
      .use(requestLogger())
      .use(corsMiddleware())
      .use(provider<DataService>((_) => DataService()));
}

