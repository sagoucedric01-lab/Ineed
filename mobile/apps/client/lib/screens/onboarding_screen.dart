import 'package:flutter/material.dart';
import 'package:ineed_shared/ineed_shared.dart';
import 'package:ineed_ui/ineed_ui.dart';

import '../l10n/gen/app_localizations.dart';

/// C-01 : présentation en trois volets.
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({required this.onStart, super.key});

  final VoidCallback onStart;

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final _pages = PageController();
  int _index = 0;

  @override
  void dispose() {
    _pages.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final slides = [
      (l.onboarding1Title, l.onboarding1Body, Icons.edit_note_outlined),
      (l.onboarding2Title, l.onboarding2Body, Icons.near_me_outlined),
      (l.onboarding3Title, l.onboarding3Body, Icons.verified_user_outlined),
    ];
    final last = _index == slides.length - 1;
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Align(alignment: Alignment.centerRight, child: TextButton(onPressed: widget.onStart, child: Text(l.onboardingSkip))),
            Expanded(
              child: PageView(
                controller: _pages,
                onPageChanged: (i) => setState(() => _index = i),
                children: [
                  for (final (title, body, icon) in slides)
                    Padding(
                      padding: const EdgeInsets.all(IneedSpacing.s6),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(icon, size: 96, color: context.ineedColors.action),
                          const SizedBox(height: IneedSpacing.s8),
                          Text(title, style: text.headlineMedium, textAlign: TextAlign.center),
                          const SizedBox(height: IneedSpacing.s3),
                          Text(body, style: text.bodyLarge, textAlign: TextAlign.center),
                        ],
                      ),
                    ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(IneedSpacing.s4),
              child: IneedButton(
                label: last ? l.onboardingStart : CommonLocalizations.of(context).actionContinue,
                onPressed: last ? widget.onStart : () => _pages.nextPage(duration: IneedMotion.base, curve: Curves.easeOut),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
