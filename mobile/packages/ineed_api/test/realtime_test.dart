import 'dart:convert';

import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_api/testing.dart';
import 'package:test/test.dart';

void main() {
  test('canal temps réel : adresse ws(s), authentification par le premier message, événements reçus', () async {
    final channels = <FakeWebSocketChannel>[];
    Uri? opened;
    final rt = RealtimeClient(
      apiBaseUrl: Uri.parse('https://api.ineed.ci/'),
      accessToken: () async => 'jeton-A',
      connect: (uri) {
        opened = uri;
        return (FakeWebSocketChannel()..let(channels.add));
      },
    );
    final events = <RealtimeEvent>[];
    final sub = rt.events.listen(events.add);
    await rt.start();
    expect(opened.toString(), 'wss://api.ineed.ci/v1/realtime');
    expect(jsonDecode(channels.single.sent.single! as String), {'type': 'auth', 'token': 'jeton-A'});
    channels.single.push({'type': 'ready'});
    channels.single.push({'type': 'message', 'conversationId': 'c1', 'message': {'id': 'x'}});
    await Future<void>.delayed(Duration.zero);
    expect(events.map((e) => e.type), ['ready', 'message']);
    expect(events.last.conversationId, 'c1');
    await sub.cancel();
    await rt.close();
  });

  test('sans session : aucune connexion ; identifiants de message uniques', () async {
    var calls = 0;
    final rt = RealtimeClient(apiBaseUrl: Uri.parse('http://api.test'), accessToken: () async => null, connect: (_) {
      calls++;
      return FakeWebSocketChannel();
    });
    await rt.start();
    expect(calls, 0);
    expect(rt.uri.toString(), 'ws://api.test/v1/realtime');
    await rt.close();
    final ids = {for (var i = 0; i < 200; i++) newClientMessageId()};
    expect(ids, hasLength(200));
    expect(ids.first, matches(RegExp(r'^m[a-z0-9]{23}$')));
  });
}

extension<T> on T {
  void let(void Function(T) f) => f(this);
}
