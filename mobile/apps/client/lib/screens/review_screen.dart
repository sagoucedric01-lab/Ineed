import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:ineed_shared/ineed_shared.dart';
import 'package:ineed_ui/ineed_ui.dart';

import '../l10n/gen/app_localizations.dart';
import 'mission_engagement.dart';

/// C-25b : évaluation du professionnel après une mission clôturée.
class ReviewScreen extends ConsumerStatefulWidget {
  const ReviewScreen({required this.missionId, required this.proName, super.key});

  final String missionId;
  final String proName;

  @override
  ConsumerState<ReviewScreen> createState() => _ReviewScreenState();
}

class _ReviewScreenState extends ConsumerState<ReviewScreen> {
  int _rating = 0;
  final _comment = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _comment.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final l = AppLocalizations.of(context);
    final common = CommonLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    if (_rating == 0) {
      setState(() => _error = l.reviewRateFirst);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final r = await ref.read(apiProvider).submitReview(widget.missionId, rating: _rating, comment: _comment.text);
      ref.invalidate(missionReviewProvider(widget.missionId));
      messenger.showSnackBar(SnackBar(content: Text(r.status == 'PUBLISHED' ? l.reviewThanks : l.reviewPending)));
      if (mounted) context.pop();
    } on Object catch (e) {
      if (mounted) setState(() => _error = failureMessage(common, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final c = context.ineedColors;
    return Scaffold(
      appBar: AppBar(title: Text(l.reviewTitle)),
      body: ListView(
        padding: const EdgeInsets.all(IneedSpacing.s4),
        children: [
          Text(l.reviewPrompt(widget.proName), style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: IneedSpacing.s3),
          Row(mainAxisAlignment: MainAxisAlignment.center, children: [
            for (var i = 1; i <= 5; i++)
              IconButton(
                tooltip: l.reviewStars('$i'),
                iconSize: 40,
                onPressed: () => setState(() => _rating = i),
                icon: Icon(i <= _rating ? Icons.star : Icons.star_border, color: c.rating),
              ),
          ]),
          if (_rating > 0) Center(child: Text(l.reviewStars('$_rating'))),
          const SizedBox(height: IneedSpacing.s3),
          TextField(controller: _comment, minLines: 3, maxLines: 6, maxLength: 1000, decoration: InputDecoration(labelText: l.reviewCommentHint)),
          if (_error != null) IneedBanner(message: _error!, tone: IneedBannerTone.danger),
          const SizedBox(height: IneedSpacing.s3),
          IneedButton(label: l.reviewSubmit, loading: _busy, onPressed: _submit),
        ],
      ),
    );
  }
}
