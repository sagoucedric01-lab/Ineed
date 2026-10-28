import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_shared/ineed_shared.dart';
import 'package:ineed_ui/ineed_ui.dart';

import '../l10n/gen/app_localizations.dart';
import '../providers.dart';
import '../widgets/async_body.dart';

typedef _ActivityData = ({ProProfile? profile, List<Category> categories, List<Zone> zones});

final _activityDataProvider = FutureProvider.autoDispose<_ActivityData>((ref) async {
  final results = await Future.wait([ref.watch(proProfileProvider.future), ref.watch(categoriesProvider.future), ref.watch(zonesProvider.future)]);
  return (profile: results[0] as ProProfile?, categories: results[1]! as List<Category>, zones: results[2]! as List<Zone>);
});

/// P-04 à P-06 : type de compte, métiers et spécialités, communes desservies, horaires.
class ActivityScreen extends ConsumerWidget {
  const ActivityScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(title: Text(AppLocalizations.of(context).dossierStepActivity)),
      body: AsyncBody(
        value: ref.watch(_activityDataProvider),
        onRetry: () => ref.invalidate(_activityDataProvider),
        builder: (d) => _ActivityForm(data: d),
      ),
    );
  }
}

class _ActivityForm extends ConsumerStatefulWidget {
  const _ActivityForm({required this.data});

  final _ActivityData data;

  @override
  ConsumerState<_ActivityForm> createState() => _ActivityFormState();
}

class _Hours {
  _Hours(this.start, this.end);
  TimeOfDay start;
  TimeOfDay end;
}

TimeOfDay _parse(String hhmm) => TimeOfDay(hour: int.parse(hhmm.substring(0, 2)), minute: int.parse(hhmm.substring(3, 5)));
String _format(TimeOfDay t) => '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
int _minutes(TimeOfDay t) => t.hour * 60 + t.minute;

class _ActivityFormState extends ConsumerState<_ActivityForm> {
  late String _kind;
  late final TextEditingController _businessName;
  late final TextEditingController _companyReg;
  late final TextEditingController _bio;
  late final TextEditingController _years;
  late final Set<String> _categoryIds;
  late final Set<String> _skillIds;
  late final Set<String> _zoneIds;
  // Une plage par jour (1 = lundi … 7 = dimanche) ; absente = fermé.
  final Map<int, _Hours> _hours = {};
  String? _error;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final p = widget.data.profile;
    _kind = p?.kind ?? 'INDIVIDUAL';
    _businessName = TextEditingController(text: p?.businessName ?? '');
    _companyReg = TextEditingController(text: p?.companyRegNumber ?? '');
    _bio = TextEditingController(text: p?.bio ?? '');
    _years = TextEditingController(text: p?.yearsExperience?.toString() ?? '');
    _categoryIds = {...?p?.categoryIds};
    _skillIds = {...?p?.skillIds};
    _zoneIds = {...?p?.zoneIds};
    if (p == null) {
      // Proposition de départ, modifiable : du lundi au samedi, de 8 h à 18 h.
      for (var d = 1; d <= 6; d++) {
        _hours[d] = _Hours(const TimeOfDay(hour: 8, minute: 0), const TimeOfDay(hour: 18, minute: 0));
      }
    } else {
      for (final h in p.weeklyHours) {
        _hours.putIfAbsent(h.weekday, () => _Hours(_parse(h.start), _parse(h.end)));
      }
    }
  }

  @override
  void dispose() {
    _businessName.dispose();
    _companyReg.dispose();
    _bio.dispose();
    _years.dispose();
    super.dispose();
  }

  String? _validate(AppLocalizations l, CommonLocalizations common) {
    if (_businessName.text.trim().length < 2) return l.activityBusinessNameInvalid;
    if (_kind == 'COMPANY' && _companyReg.text.trim().isEmpty) return '${l.signupCompanyReg}\u00A0: ${common.errorRequired}';
    if (_categoryIds.isEmpty || _categoryIds.length > 3) return l.activityTradesInvalid;
    if (_zoneIds.isEmpty) return l.activityZonesInvalid;
    if (_hours.isEmpty || _hours.values.any((h) => _minutes(h.end) <= _minutes(h.start))) return l.activityHoursInvalid;
    return null;
  }

  Future<void> _save() async {
    final l = AppLocalizations.of(context);
    final common = CommonLocalizations.of(context);
    final error = _validate(l, common);
    setState(() => _error = error);
    if (error != null) return;
    final messenger = ScaffoldMessenger.of(context);
    final router = GoRouter.of(context);
    // Les spécialités ne sont conservées que pour les métiers encore choisis.
    final allowedSkills = {
      for (final c in widget.data.categories)
        if (_categoryIds.contains(c.id)) ...c.skills.map((s) => s.id),
    };
    setState(() => _saving = true);
    try {
      await ref.read(apiProvider).saveProProfile(ProProfileDraft(
            kind: _kind,
            businessName: _businessName.text.trim(),
            companyRegNumber: _kind == 'COMPANY' ? _companyReg.text.trim() : null,
            bio: _bio.text.trim(),
            yearsExperience: int.tryParse(_years.text),
            categoryIds: _categoryIds.toList(),
            skillIds: _skillIds.where(allowedSkills.contains).toList(),
            zoneIds: _zoneIds.toList(),
            weeklyHours: [
              for (final e in (_hours.entries.toList()..sort((a, b) => a.key.compareTo(b.key))))
                WeeklyHour(weekday: e.key, start: _format(e.value.start), end: _format(e.value.end)),
            ],
          ));
      ref.invalidate(proProfileProvider);
      messenger.showSnackBar(SnackBar(content: Text(l.activitySaved)));
      router.pop();
    } on Object catch (e) {
      if (mounted) setState(() => _error = failureMessage(common, e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _pickTime(int weekday, {required bool start}) async {
    final h = _hours[weekday]!;
    final picked = await showTimePicker(context: context, initialTime: start ? h.start : h.end);
    if (picked == null) return;
    setState(() => start ? h.start = picked : h.end = picked);
  }

  String _weekday(AppLocalizations l, int d) => switch (d) {
        1 => l.weekday1,
        2 => l.weekday2,
        3 => l.weekday3,
        4 => l.weekday4,
        5 => l.weekday5,
        6 => l.weekday6,
        _ => l.weekday7,
      };

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final common = CommonLocalizations.of(context);
    final c = context.ineedColors;
    final text = Theme.of(context).textTheme;
    final selectedCategories = widget.data.categories.where((cat) => _categoryIds.contains(cat.id)).toList();
    Widget section(String title, [String? help]) => Padding(
          padding: const EdgeInsets.only(top: IneedSpacing.s6, bottom: IneedSpacing.s2),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: text.titleMedium),
              if (help != null) Text(help, style: text.bodySmall?.copyWith(color: c.textMuted)),
            ],
          ),
        );

    return ListView(
      padding: const EdgeInsets.all(IneedSpacing.s4),
      children: [
        Text(l.signupTypeTitle, style: text.titleMedium),
        const SizedBox(height: IneedSpacing.s2),
        RadioGroup<String>(
          groupValue: _kind,
          onChanged: (v) => setState(() => _kind = v!),
          child: Column(
            children: [
              RadioListTile(value: 'INDIVIDUAL', title: Text(l.signupTypeIndividual), subtitle: Text(l.signupTypeIndividualHelp)),
              RadioListTile(value: 'COMPANY', title: Text(l.signupTypeCompany), subtitle: Text(l.signupTypeCompanyHelp)),
            ],
          ),
        ),
        const SizedBox(height: IneedSpacing.s4),
        TextField(
          controller: _businessName,
          maxLength: 80,
          textCapitalization: TextCapitalization.words,
          decoration: InputDecoration(labelText: l.signupBusinessName, hintText: l.signupBusinessNameHint),
        ),
        if (_kind == 'COMPANY')
          TextField(controller: _companyReg, maxLength: 40, textCapitalization: TextCapitalization.characters, decoration: InputDecoration(labelText: l.signupCompanyReg)),
        TextField(
          controller: _bio,
          maxLength: 800,
          minLines: 3,
          maxLines: 6,
          decoration: InputDecoration(labelText: l.signupBio, hintText: l.signupBioHint),
        ),
        TextField(
          controller: _years,
          keyboardType: TextInputType.number,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(2)],
          decoration: InputDecoration(labelText: l.signupExperience),
        ),
        section(l.signupTradesTitle, l.signupTradesHelp),
        Wrap(
          spacing: IneedSpacing.s2,
          runSpacing: IneedSpacing.s2,
          children: [
            for (final cat in widget.data.categories)
              FilterChip(
                avatar: IneedCategoryIcon(iconKey: cat.iconKey, size: 18),
                label: Text(cat.name),
                selected: _categoryIds.contains(cat.id),
                onSelected: !_categoryIds.contains(cat.id) && _categoryIds.length >= 3
                    ? null
                    : (on) => setState(() => on ? _categoryIds.add(cat.id) : _categoryIds.remove(cat.id)),
              ),
          ],
        ),
        if (selectedCategories.any((cat) => cat.skills.isNotEmpty)) ...[
          section(l.signupSkillsTitle),
          Wrap(
            spacing: IneedSpacing.s2,
            runSpacing: IneedSpacing.s2,
            children: [
              for (final cat in selectedCategories)
                for (final s in cat.skills)
                  FilterChip(
                    label: Text(s.name),
                    selected: _skillIds.contains(s.id),
                    onSelected: (on) => setState(() => on ? _skillIds.add(s.id) : _skillIds.remove(s.id)),
                  ),
            ],
          ),
        ],
        section(l.signupZonesTitle, l.signupZonesHelp),
        Wrap(
          spacing: IneedSpacing.s2,
          runSpacing: IneedSpacing.s2,
          children: [
            for (final z in widget.data.zones)
              FilterChip(
                label: Text(z.name),
                selected: _zoneIds.contains(z.id),
                onSelected: (on) => setState(() => on ? _zoneIds.add(z.id) : _zoneIds.remove(z.id)),
              ),
          ],
        ),
        section(l.signupHoursTitle),
        for (var d = 1; d <= 7; d++)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: IneedSpacing.s1),
            child: Row(
              children: [
                Switch(
                  value: _hours.containsKey(d),
                  onChanged: (on) => setState(() => on ? _hours[d] = _Hours(const TimeOfDay(hour: 8, minute: 0), const TimeOfDay(hour: 18, minute: 0)) : _hours.remove(d)),
                ),
                const SizedBox(width: IneedSpacing.s2),
                SizedBox(width: 88, child: Text(_weekday(l, d))),
                if (_hours[d] case final h?) ...[
                  Text(l.hoursFrom),
                  TextButton(onPressed: () => _pickTime(d, start: true), child: Text(_format(h.start))),
                  Text(l.hoursTo),
                  TextButton(onPressed: () => _pickTime(d, start: false), child: Text(_format(h.end))),
                ] else
                  Text(l.signupHoursClosed, style: TextStyle(color: c.textMuted)),
              ],
            ),
          ),
        if (_error != null) ...[
          const SizedBox(height: IneedSpacing.s4),
          Text(_error!, style: TextStyle(color: c.danger)),
        ],
        const SizedBox(height: IneedSpacing.s6),
        FilledButton(
          onPressed: _saving ? null : _save,
          child: _saving ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2)) : Text(common.actionSave),
        ),
      ],
    );
  }
}
