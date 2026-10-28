import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ineed_ui/ineed_ui.dart';

Widget host(Widget child, {Brightness brightness = Brightness.light}) =>
    MaterialApp(theme: buildIneedTheme(brightness), home: Scaffold(body: Padding(padding: const EdgeInsets.all(16), child: child)));

void main() {
  test('les thèmes clair et sombre utilisent les couleurs des tokens', () {
    final light = buildIneedTheme(Brightness.light);
    final dark = buildIneedTheme(Brightness.dark);
    expect(light.colorScheme.primary, IneedColorScheme.light.action);
    expect(light.scaffoldBackgroundColor, IneedColorScheme.light.background);
    expect(dark.colorScheme.primary, IneedColorScheme.dark.action);
    expect(dark.extension<IneedColors>()!.scheme, IneedColorScheme.dark);
    expect(light.textTheme.titleLarge!.fontFamily, 'packages/ineed_ui/Plus Jakarta Sans');
  });

  testWidgets('IneedButton déclenche son action et fait au moins 48 px de haut', (tester) async {
    var taps = 0;
    await tester.pumpWidget(host(IneedButton(label: 'Continuer', onPressed: () => taps++)));
    await tester.tap(find.text('Continuer'));
    expect(taps, 1);
    expect(tester.getSize(find.byType(FilledButton)).height, greaterThanOrEqualTo(48));
  });

  testWidgets('IneedButton en chargement ignore les appuis (pas de double envoi)', (tester) async {
    var taps = 0;
    await tester.pumpWidget(host(IneedButton(label: 'Payer', loading: true, onPressed: () => taps++)));
    await tester.tap(find.byType(FilledButton));
    expect(taps, 0);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('variante urgente : fond orange et texte bleu nuit', (tester) async {
    await tester.pumpWidget(host(IneedButton(label: 'Intervention immédiate', variant: IneedButtonVariant.urgent, onPressed: () {})));
    final button = tester.widget<FilledButton>(find.byType(FilledButton));
    expect(button.style!.backgroundColor!.resolve({}), IneedColorScheme.light.urgent);
    expect(button.style!.foregroundColor!.resolve({}), IneedColorScheme.light.onUrgent);
  });

  testWidgets('IneedBanner affiche son action seulement si elle est reliée', (tester) async {
    var retried = false;
    await tester.pumpWidget(host(Column(children: [
      IneedBanner(message: 'Pas de connexion internet.', tone: IneedBannerTone.danger, actionLabel: 'Réessayer', onAction: () => retried = true),
      const IneedBanner(message: 'Information', actionLabel: 'Sans action'),
    ])));
    expect(find.text('Sans action'), findsNothing);
    await tester.tap(find.text('Réessayer'));
    expect(retried, isTrue);
  });

  testWidgets('IneedLogo se charge depuis les ressources du paquet', (tester) async {
    await tester.pumpWidget(host(const IneedLogo(pro: true)));
    await tester.pumpAndSettle();
    expect(find.bySemanticsLabel('Ineed Pro'), findsOneWidget);
  });
}
