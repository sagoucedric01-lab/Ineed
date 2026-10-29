import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_client/services/location.dart';
import 'package:ineed_client/services/voice_recorder.dart';
import 'package:ineed_shared/ineed_shared.dart';

import 'helpers.dart';
import 'marketplace_helpers.dart';

InMemoryTokenStore signedIn() => InMemoryTokenStore()..tokens = const StoredTokens(accessToken: 'A', refreshToken: 'R');

/// Fait défiler la liste jusqu'à l'élément si nécessaire, puis le touche.
Future<void> tapAndSettle(WidgetTester tester, Finder finder) async {
  FocusManager.instance.primaryFocus?.unfocus();
  await tester.pumpAndSettle();
  if (finder.evaluate().isEmpty) await tester.scrollUntilVisible(finder, 200, scrollable: find.byType(Scrollable).first);
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

Future<void> pumpMarket(WidgetTester tester, ClientBackend b, {FakeRecorder? recorder, PositionFinder? position}) async {
  await pumpClientApp(tester, b.server, signedIn(), tallScreen: true, overrides: [
    photoPickerProvider.overrideWithValue((_) async => jpegBytes),
    voiceRecorderProvider.overrideWithValue(recorder ?? FakeRecorder()),
    positionFinderProvider.overrideWithValue(position ?? fakePosition),
  ]);
}

void main() {
  testWidgets('accueil : adresse à choisir, recherche, deux modes d’intervention, métiers, recherches récentes, notifications', (tester) async {
    final b = ClientBackend();
    await pumpMarket(tester, b);
    expect(find.text('Bonjour Awa'), findsOneWidget);
    expect(find.text('Choisir une adresse'), findsOneWidget);
    expect(find.text('Intervention immédiate'), findsOneWidget);
    expect(find.text('Programmer une intervention'), findsOneWidget);
    expect(find.text('Plomberie'), findsOneWidget);
    expect(find.text('fuite'), findsOneWidget);
    expect(find.text('2'), findsOneWidget); // notifications non lues

    await tapAndSettle(tester, find.byIcon(Icons.notifications_outlined));
    expect(find.text('Bienvenue sur Ineed'), findsOneWidget);
    await tapAndSettle(tester, find.text('Tout marquer comme lu'));
    expect(b.server.count('POST /v1/me/notifications/read'), 1);
  });

  testWidgets('adresse sans carte : position du téléphone, commune déduite, repère obligatoire, puis choisie sur l’accueil', (tester) async {
    final b = ClientBackend();
    await pumpMarket(tester, b);
    await tapAndSettle(tester, find.text('Choisir une adresse'));
    expect(find.text('Aucune adresse enregistrée. Ajoutez celle où le professionnel doit intervenir.'), findsOneWidget);
    await tapAndSettle(tester, find.text('Ajouter une adresse'));
    // Pas de fond de carte configuré dans l'environnement de test : saisie par la position, la commune et un repère.
    expect(find.textContaining('La carte n’est pas disponible'), findsOneWidget);

    await tapAndSettle(tester, find.text('Utiliser ma position actuelle'));
    expect(b.server.last('GET /v1/geo/locate').queryParameters, {'lat': 5.355, 'lng': -3.975});
    expect(find.text('Commune déduite de la position : vérifiez-la.'), findsOneWidget);

    await tapAndSettle(tester, find.text('Enregistrer l’adresse'));
    expect(find.text('Indiquez un repère (ou une rue) pour que le professionnel trouve l’endroit.'), findsOneWidget);
    expect(b.server.count('POST /v1/me/addresses'), 0);

    await tester.enterText(find.widgetWithText(TextField, 'Point de repère'), 'Face à l’école, portail vert');
    await tester.enterText(find.widgetWithText(TextField, 'Nom de l’adresse (facultatif)'), 'Maison');
    await tapAndSettle(tester, find.text('Enregistrer l’adresse'));
    expect(b.server.last('POST /v1/me/addresses').data, {
      'location': {'lat': 5.355, 'lng': -3.975},
      'zoneId': 'z1',
      'label': 'Maison',
      'landmark': 'Face à l’école, portail vert',
    });
    // Nouvelle adresse sélectionnée et affichée sur l'accueil.
    expect(find.text('Maison · Cocody'), findsOneWidget);
  });

  testWidgets('localisation refusée : message, la commune reste à choisir à la main', (tester) async {
    final b = ClientBackend();
    await pumpMarket(tester, b, position: deniedPosition);
    await tapAndSettle(tester, find.text('Choisir une adresse'));
    await tapAndSettle(tester, find.text('Ajouter une adresse'));
    await tapAndSettle(tester, find.text('Utiliser ma position actuelle'));
    expect(find.textContaining('La localisation est désactivée'), findsOneWidget);
    await tapAndSettle(tester, find.byType(DropdownButtonFormField<String>));
    await tapAndSettle(tester, find.text('Marcory').last);
    await tester.enterText(find.widgetWithText(TextField, 'Point de repère'), 'Marché de Marcory');
    await tapAndSettle(tester, find.text('Enregistrer l’adresse'));
    // Sans carte, le point retenu est le centre de la commune choisie.
    expect(b.server.last('POST /v1/me/addresses').data, {'location': {'lat': 5.3, 'lng': -3.9833}, 'zoneId': 'z2', 'landmark': 'Marché de Marcory'});
  });

  testWidgets('T4 — métier : professionnels proches (distance, délai, vérifié), profil public', (tester) async {
    final b = ClientBackend();
    withHomeAddress(b);
    await pumpMarket(tester, b);
    await tapAndSettle(tester, find.text('Plomberie'));
    final q = b.server.last('GET /v1/pros/search').queryParameters;
    expect(q, {'categoryId': 'c1', 'mode': 'URGENT', 'lat': 5.36, 'lng': -3.97, 'zoneId': 'z1'});
    expect(find.text('Dans un rayon de 3,0 km autour de Cocody'), findsOneWidget);
    expect(find.text('Koffi Plomberie'), findsOneWidget);
    expect(find.text('À 0,8 km'), findsOneWidget);
    expect(find.text('Arrivée estimée : 15 min'), findsOneWidget);
    expect(find.text('Intervient dans votre commune'), findsOneWidget);
    expect(find.text('Vérifié par Ineed'), findsNWidgets(2));

    // Prestation à prix fixe : prix affiché, recherche relancée.
    await tapAndSettle(tester, find.text('Remplacement de robinet'));
    expect(find.textContaining('Prix fixe : 15'), findsOneWidget);
    expect(b.server.last('GET /v1/pros/search').queryParameters['serviceId'], 's2');

    await tapAndSettle(tester, find.text('Koffi Plomberie'));
    expect(find.text('Plombier depuis 12 ans.'), findsOneWidget);
    expect(find.text('12 ans d’expérience'), findsOneWidget);
    expect(find.text('Nouveau sur Ineed'), findsOneWidget);
  });

  testWidgets('T6 — aucun professionnel : élargir le rayon, puis passer en demande programmée', (tester) async {
    final b = ClientBackend()..searchItems = (_) => [];
    withHomeAddress(b);
    await pumpMarket(tester, b);
    await tapAndSettle(tester, find.text('Climatisation'));
    expect(find.text('Aucun professionnel disponible pour le moment'), findsOneWidget);
    await tapAndSettle(tester, find.text('Élargir la zone de recherche'));
    expect(b.server.last('GET /v1/pros/search').queryParameters['radiusM'], 6000);
    await tapAndSettle(tester, find.text('Envoyer une demande programmée'));
    final q = b.server.last('GET /v1/pros/search').queryParameters;
    expect(q['mode'], 'SCHEDULED');
    expect(q.containsKey('radiusM'), isFalse);
    expect(DateTime.parse(q['start']! as String).toUtc().hour, 9);
    expect(find.text('Choisir un autre horaire'), findsOneWidget);
  });

  testWidgets('recherche par mots : métier et prestation', (tester) async {
    final b = ClientBackend();
    withHomeAddress(b);
    await pumpMarket(tester, b);
    await tapAndSettle(tester, find.text('Décrivez votre problème ou cherchez un métier'));
    await tester.enterText(find.byType(TextField), 'fuite');
    await tester.pump(const Duration(milliseconds: 500));
    await tester.pumpAndSettle();
    expect(b.server.last('GET /v1/catalog/search').queryParameters, {'q': 'fuite'});
    await tapAndSettle(tester, find.text('Fuite d’eau'));
    expect(b.server.last('GET /v1/pros/search').queryParameters['serviceId'], 's1');
  });

  testWidgets('T5 — demande : description, photo, note vocale, adresse ; relecture, publication, annulation', (tester) async {
    final b = ClientBackend();
    withHomeAddress(b);
    final recorder = FakeRecorder();
    await pumpMarket(tester, b, recorder: recorder);
    await tapAndSettle(tester, find.text('Plomberie'));
    await tapAndSettle(tester, find.text('Fuite d’eau'));
    await tapAndSettle(tester, find.text('Décrire mon besoin'));
    expect(find.text('Nouvelle demande'), findsOneWidget);

    await tester.enterText(find.widgetWithText(TextField, 'Description'), 'Fuite');
    await tapAndSettle(tester, find.text('Relire ma demande'));
    expect(find.text('Ajoutez quelques détails (10 caractères minimum) pour aider le professionnel.'), findsOneWidget);
    expect(b.server.count('POST /v1/requests'), 0);

    await tester.enterText(find.widgetWithText(TextField, 'Description'), 'L’eau fuit sous l’évier de la cuisine.');
    await tapAndSettle(tester, find.bySemanticsLabel('Ajouter une photo'));
    await tapAndSettle(tester, find.text('Choisir dans la galerie'));
    await tapAndSettle(tester, find.text('Enregistrer une note vocale'));
    expect(recorder.started, 1);
    await tapAndSettle(tester, find.textContaining('Arrêter l’enregistrement'));
    expect(find.text('Note vocale de 7 s'), findsOneWidget);
    await tester.enterText(find.byType(TextField).last, '15000');
    await tapAndSettle(tester, find.text('Relire ma demande'));

    expect(b.server.requests.where((r) => r.uri.path == '/v1/files').map((r) => (r.data as Map)['purpose']), ['REQUEST_PHOTO', 'REQUEST_VOICE']);
    expect((b.server.last('POST /v1/files').data as Map)['mimeType'], 'audio/mp4');
    final body = b.server.last('POST /v1/requests').data as Map;
    expect(body, {
      'categoryId': 'c1',
      'serviceId': 's1',
      'mode': 'URGENT',
      'description': 'L’eau fuit sous l’évier de la cuisine.',
      'addressId': 'a1',
      'budgetXof': 15000,
      'photoFileIds': ['f1'],
      'voiceFileId': 'f2',
    });

    // Relecture du brouillon.
    expect(find.text('Vérifiez votre demande'), findsOneWidget);
    expect(find.text('Brouillon'), findsOneWidget);
    expect(find.textContaining('Votre adresse précise et votre prénom ne sont communiqués qu’au professionnel retenu'), findsOneWidget);
    await tapAndSettle(tester, find.text('Publier la demande'));
    expect(b.server.count('POST /v1/requests/r1/publish'), 1);
    expect(find.text('Publiée'), findsWidgets);
    // Recherche lancée : le client voit qu'elle est en cours.
    expect(find.text('Recherche en cours'), findsOneWidget);

    await tapAndSettle(tester, find.text('Annuler la demande'));
    await tapAndSettle(tester, find.text('Annuler la demande').last);
    expect(b.server.count('POST /v1/requests/r1/cancel'), 1);
    expect(find.text('Annulée'), findsOneWidget);
  });

  testWidgets('demande programmée depuis l’accueil : créneau envoyé en UTC (heure d’Abidjan)', (tester) async {
    final b = ClientBackend();
    withHomeAddress(b);
    await pumpMarket(tester, b);
    await tapAndSettle(tester, find.text('Programmer une intervention'));
    await tapAndSettle(tester, find.byType(DropdownButtonFormField<String>));
    await tapAndSettle(tester, find.text('Plomberie').last);
    await tester.enterText(find.widgetWithText(TextField, 'Description'), 'Installer un nouveau chauffe-eau.');
    await tapAndSettle(tester, find.text('Relire ma demande'));
    final body = b.server.last('POST /v1/requests').data as Map;
    expect(body['mode'], 'SCHEDULED');
    final window = body['window'] as Map;
    expect(DateTime.parse(window['start'] as String).hour, 9);
    expect(DateTime.parse(window['end'] as String).hour, 12);
    expect(find.text('Vérifiez votre demande'), findsOneWidget);
  });

  testWidgets('micro refusé : message, la demande reste possible par écrit', (tester) async {
    final b = ClientBackend();
    withHomeAddress(b);
    await pumpMarket(tester, b, recorder: FakeRecorder()..allowed = false);
    await tapAndSettle(tester, find.text('Intervention immédiate'));
    await tapAndSettle(tester, find.text('Enregistrer une note vocale'));
    expect(find.textContaining('L’accès au micro est refusé'), findsOneWidget);
  });

  testWidgets('mes demandes : en cours depuis l’accueil', (tester) async {
    final b = ClientBackend();
    withHomeAddress(b);
    await pumpMarket(tester, b);
    await tapAndSettle(tester, find.text('Intervention immédiate'));
    await tapAndSettle(tester, find.byType(DropdownButtonFormField<String>));
    await tapAndSettle(tester, find.text('Plomberie').last);
    await tester.enterText(find.widgetWithText(TextField, 'Description'), 'Le robinet de la douche goutte.');
    await tapAndSettle(tester, find.text('Relire ma demande'));
    // Le formulaire a été remplacé par la relecture : un seul retour mène à l'accueil.
    await tapAndSettle(tester, find.byType(BackButton));
    expect(find.text('En cours'), findsOneWidget);
    await tapAndSettle(tester, find.text('Tout voir'));
    expect(find.text('Mes demandes'), findsOneWidget);
    expect(find.text('Brouillon'), findsOneWidget);
  });
}
