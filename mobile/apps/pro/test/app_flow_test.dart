import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_pro/router.dart';
import 'package:ineed_shared/ineed_shared.dart';

import 'helpers.dart';

void main() {
  testWidgets('inscription : numéro, code (application Pro), nom, puis dossier à compléter', (tester) async {
    final backend = ProBackend(firstName: null, lastName: null);
    final store = InMemoryTokenStore();
    await pumpProApp(tester, backend, store);

    await tester.enterText(find.byType(TextField), '0712345678');
    await tapAndSettle(tester, find.text('Recevoir le code'));
    await tester.enterText(find.byType(TextField), '123456');
    await tester.pumpAndSettle();
    expect((backend.server.last('POST /v1/auth/otp/verify').data as Map)['app'], 'PRO');

    await tester.enterText(find.byType(TextField).at(0), 'Koffi');
    await tester.enterText(find.byType(TextField).at(1), 'Yao');
    await tapAndSettle(tester, find.text('Continuer'));

    expect(find.text('Mon dossier'), findsOneWidget);
    expect(find.text('À compléter'), findsNWidgets(3));
    expect(find.text('Complété'), findsOneWidget);
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Envoyer mon dossier')).onPressed, isNull);
    expect(find.text('Toutes les étapes doivent être complétées pour envoyer le dossier.'), findsOneWidget);
  });

  testWidgets('activité : contrôles avant envoi, puis enregistrement des métiers, communes et horaires', (tester) async {
    final backend = ProBackend();
    await pumpProApp(tester, backend, signedInStore());
    await tapAndSettle(tester, find.text('Mon activité'));

    await tester.enterText(find.widgetWithText(TextField, 'Nom affiché aux clients'), 'Koffi Plomberie');
    await tapAndSettle(tester, find.text('Enregistrer'));
    expect(find.text('Choisissez entre 1 et 3 métiers.'), findsOneWidget);
    expect(backend.server.count('PUT /v1/pro/profile'), 0);

    await tapAndSettle(tester, find.widgetWithText(FilterChip, 'Plomberie'));
    // Les spécialités du métier choisi apparaissent.
    await tapAndSettle(tester, find.widgetWithText(FilterChip, 'Recherche de fuite'));
    await tapAndSettle(tester, find.text('Enregistrer'));
    expect(find.text('Choisissez au moins une commune.'), findsOneWidget);

    await tapAndSettle(tester, find.widgetWithText(FilterChip, 'Cocody'));
    // Dimanche reste fermé ; samedi est retiré.
    await tapAndSettle(tester, find.byType(Switch).at(5));
    await tapAndSettle(tester, find.text('Enregistrer'));

    final body = backend.server.last('PUT /v1/pro/profile').data as Map;
    expect(body['kind'], 'INDIVIDUAL');
    expect(body['businessName'], 'Koffi Plomberie');
    expect(body['categoryIds'], ['c1']);
    expect(body['skillIds'], ['s1']);
    expect(body['zoneIds'], ['z1']);
    expect((body['weeklyHours'] as List).map((h) => (h as Map)['weekday']), [1, 2, 3, 4, 5]);
    expect((body['weeklyHours'] as List).first, {'weekday': 1, 'start': '08:00', 'end': '18:00'});
    expect(body.containsKey('companyRegNumber'), isFalse);

    // Retour au dossier : l'étape est complétée.
    expect(find.text('Activité enregistrée.'), findsOneWidget);
    expect(find.text('Mon dossier'), findsOneWidget);
    expect(find.text('Complété'), findsNWidgets(2));
  });

  testWidgets('entreprise : le numéro RCCM est demandé', (tester) async {
    final backend = ProBackend();
    await pumpProApp(tester, backend, signedInStore());
    await tapAndSettle(tester, find.text('Mon activité'));
    await tapAndSettle(tester, find.text('Pour une entreprise'));
    await tester.enterText(find.widgetWithText(TextField, 'Nom affiché aux clients'), 'Koffi Services SARL');
    await tapAndSettle(tester, find.text('Enregistrer'));
    expect(find.text('Numéro RCCM\u00A0: Ce champ est obligatoire.'), findsOneWidget);
    expect(backend.server.count('PUT /v1/pro/profile'), 0);
  });

  testWidgets('photo et justificatif PDF, puis envoi du dossier et écran de suivi', (tester) async {
    final backend = ProBackend(proStatus: 'DRAFT', profile: filledProfile());
    await pumpProApp(tester, backend, signedInStore());
    expect(find.text('À compléter'), findsNWidgets(2));

    // Photo : envoyée, puis enregistrée comme photo de profil.
    await tapAndSettle(tester, find.byType(AvatarPicker));
    await tapAndSettle(tester, find.text('Choisir dans la galerie'));
    expect((backend.server.last('POST /v1/files').data as Map)['purpose'], 'AVATAR');
    expect(backend.server.count('PUT /v1/me/avatar'), 1);
    expect(find.text('À compléter'), findsOneWidget);

    // Justificatif obligatoire au format PDF.
    await tapAndSettle(tester, find.text('Mes justificatifs'));
    expect(find.text('Obligatoire'), findsOneWidget);
    expect(find.text('Facultatif'), findsOneWidget);
    await tapAndSettle(tester, find.text('Ajouter le document').first);
    await tapAndSettle(tester, find.text('Choisir un fichier PDF'));
    final ticket = backend.server.last('POST /v1/files').data as Map;
    expect(ticket['purpose'], 'VERIFICATION_DOC');
    expect(ticket['mimeType'], 'application/pdf');
    expect(ticket['sizeBytes'], pdfBytes.length);
    expect(backend.server.count('PUT /upload/f1'), 2);
    expect(backend.server.last('POST /v1/pro/documents').data, {'typeCode': 'PIECE_IDENTITE', 'fileId': 'f1'});
    expect(find.text('En attente de vérification'), findsOneWidget);
    expect(find.text('Remplacer'), findsOneWidget);

    await tapAndSettle(tester, find.byType(BackButton));
    expect(find.text('À compléter'), findsNothing);
    await tapAndSettle(tester, find.text('Envoyer mon dossier'));
    expect(backend.server.count('POST /v1/pro/profile/submit'), 1);
    expect(find.text('Dossier en cours de vérification'), findsOneWidget);
    // Le dossier envoyé n'est plus modifiable.
    expect(find.text('Mes justificatifs'), findsNothing);
  });

  testWidgets('informations demandées par l’équipe : message affiché sur le dossier', (tester) async {
    final backend = ProBackend(proStatus: 'INFO_REQUESTED', profile: filledProfile(note: 'La photo de la pièce est floue.'));
    await pumpProApp(tester, backend, signedInStore());
    expect(find.text('Informations complémentaires demandées'), findsOneWidget);
    expect(find.text('Message de l’équipe Ineed\u00A0: La photo de la pièce est floue.'), findsOneWidget);
  });

  testWidgets('dossier refusé : motif affiché', (tester) async {
    final backend = ProBackend(proStatus: 'REJECTED', profile: filledProfile(note: 'Pièce d’identité expirée'));
    await pumpProApp(tester, backend, signedInStore());
    expect(find.text('Dossier refusé'), findsOneWidget);
    expect(find.textContaining('Motif\u00A0: Pièce d’identité expirée'), findsOneWidget);
  });

  testWidgets('dossier en vérification puis validé par l’équipe : « Actualiser » ouvre le tableau de bord', (tester) async {
    final backend = ProBackend(proStatus: 'SUBMITTED', profile: filledProfile());
    await pumpProApp(tester, backend, signedInStore());
    expect(find.text('Dossier en cours de vérification'), findsOneWidget);
    backend.proStatus = 'APPROVED';
    await tapAndSettle(tester, find.text('Actualiser'));
    expect(find.text('Votre compte est validé'), findsOneWidget);
    expect(find.text('Disponible maintenant'), findsOneWidget);
  });

  testWidgets('professionnel validé : disponibilité activée sur le serveur', (tester) async {
    final backend = ProBackend(avatarUrl: 'http://storage.test/a.jpg', proStatus: 'APPROVED', profile: filledProfile());
    await pumpProApp(tester, backend, signedInStore());
    expect(find.text('Votre compte est validé'), findsOneWidget);
    expect(find.text('Vous ne recevez que les demandes programmées sur vos horaires.'), findsOneWidget);
    await tapAndSettle(tester, find.byType(Switch));
    expect(backend.server.last('PATCH /v1/pro/availability').data, {'isOnline': true});
    expect(find.text('Vous recevez les demandes urgentes autour de vous.'), findsOneWidget);
  });

  group('redirections', () {
    test('chaque espace n’est accessible que dans le statut correspondant', () {
      expect(proHome(null), '/dossier');
      expect(proHome('DRAFT'), '/dossier');
      expect(proHome('INFO_REQUESTED'), '/dossier');
      expect(proHome('SUBMITTED'), '/statut');
      expect(proHome('REJECTED'), '/statut');
      expect(proHome('SUSPENDED'), '/statut');
      expect(proHome('APPROVED'), '/tableau-de-bord');
    });
  });
}
