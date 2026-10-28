import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_shared/ineed_shared.dart';
import 'package:ineed_ui/ineed_ui.dart';

import '../l10n/gen/app_localizations.dart';
import '../providers.dart';

/// C-06 : recherche par mots du client (« fuite », « clim », « prise ») parmi les métiers et prestations.
class SearchScreen extends ConsumerStatefulWidget {
  const SearchScreen({this.initialQuery, super.key});

  final String? initialQuery;

  @override
  ConsumerState<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends ConsumerState<SearchScreen> {
  late final TextEditingController _query = TextEditingController(text: widget.initialQuery);
  Timer? _debounce;
  CatalogSearchResult? _result;
  Object? _error;
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    if ((widget.initialQuery ?? '').trim().length >= 2) _run();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _query.dispose();
    super.dispose();
  }

  void _onChanged(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), _run);
  }

  Future<void> _run() async {
    final q = _query.text.trim();
    if (q.length < 2) {
      setState(() => _result = null);
      return;
    }
    setState(() => _loading = true);
    try {
      final r = await ref.read(apiProvider).searchCatalog(q);
      if (!mounted || _query.text.trim() != q) return;
      ref.invalidate(recentSearchesProvider);
      setState(() {
        _result = r;
        _error = null;
      });
    } on Object catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final common = CommonLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final r = _result;
    return Scaffold(
      appBar: AppBar(
        title: TextField(
          controller: _query,
          autofocus: widget.initialQuery == null,
          textInputAction: TextInputAction.search,
          onChanged: _onChanged,
          onSubmitted: (_) => _run(),
          decoration: InputDecoration(hintText: l.homeSearchHint, border: InputBorder.none, filled: false),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(IneedSpacing.s4),
        children: [
          if (_loading) const LinearProgressIndicator(),
          if (_error != null) IneedBanner(message: failureMessage(common, _error!), tone: IneedBannerTone.danger, actionLabel: common.actionRetry, onAction: _run),
          if (r != null && r.isEmpty) ...[
            Text(l.searchNoResult(_query.text.trim()), style: text.titleMedium),
            const SizedBox(height: IneedSpacing.s2),
            Text(l.searchNoResultHelp),
          ],
          if (r != null && r.categories.isNotEmpty) ...[
            Text(l.homeCategories, style: text.titleSmall),
            for (final c in r.categories)
              ListTile(leading: IneedCategoryIcon(iconKey: c.iconKey), title: Text(c.name), trailing: const Icon(Icons.chevron_right), onTap: () => context.push('/metiers/${c.id}')),
          ],
          if (r != null && r.services.isNotEmpty) ...[
            const SizedBox(height: IneedSpacing.s3),
            Text(l.searchServices, style: text.titleSmall),
            for (final s in r.services)
              ListTile(
                leading: IneedCategoryIcon(iconKey: s.iconKey),
                title: Text(s.name),
                subtitle: Text(s.categoryName),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push('/metiers/${s.categoryId}?prestation=${s.id}'),
              ),
          ],
        ],
      ),
    );
  }
}
