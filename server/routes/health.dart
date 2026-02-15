import 'package:dart_frog/dart_frog.dart';

Response onRequest(RequestContext context) {
  return Response.json(
    body: {
      'status': 'ok',
      'timestamp': DateTime.now().toUtc().toIso8601String(),
      'version': '1.0.0',
    },
  );
}

