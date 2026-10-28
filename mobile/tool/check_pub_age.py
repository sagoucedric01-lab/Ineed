#!/usr/bin/env python3
"""Politique de versions : chaque paquet de pubspec.lock (dépendances indirectes comprises) doit avoir été
publié sur pub.dev depuis au moins 14 jours. Signale aussi, pour chaque paquet trop récent, la dernière
version qui respecte ce délai (à placer dans dependency_overrides de mobile/pubspec.yaml).

Usage : python3 mobile/tool/check_pub_age.py [chemin/pubspec.lock]
"""
import datetime
import json
import re
import sys
import urllib.request

MIN_AGE_DAYS = 14


def main() -> int:
    path = sys.argv[1] if len(sys.argv) > 1 else 'pubspec.lock'
    lock = open(path, encoding='utf-8').read()
    hosted = re.findall(
        r'^  ([a-z0-9_]+):\n    dependency: [^\n]+\n    description:\n      name: [^\n]+\n      sha256: [^\n]+\n'
        r'      url: "https://pub.dev"\n    source: hosted\n    version: "([^"]+)"',
        lock,
        re.M,
    )
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=MIN_AGE_DAYS)
    too_recent = []
    for name, version in hosted:
        with urllib.request.urlopen(f'https://pub.dev/api/packages/{name}', timeout=30) as res:
            info = json.load(res)
        published = {v['version']: datetime.datetime.fromisoformat(v['published'].replace('Z', '+00:00')) for v in info['versions']}
        if version not in published:
            print(f'::error::{name} {version} introuvable sur pub.dev')
            too_recent.append(name)
            continue
        if published[version] > cutoff:
            eligible = [v for v, d in published.items() if d <= cutoff and '-' not in v]
            print(f'::error::{name} {version} publié le {published[version]:%d/%m/%Y} (moins de {MIN_AGE_DAYS} jours) ; '
                  f'version admissible : {eligible[-1] if eligible else "aucune"}')
            too_recent.append(name)
    print(f'{len(hosted)} paquets vérifiés, {len(too_recent)} trop récents.')
    return 1 if too_recent else 0


if __name__ == '__main__':
    sys.exit(main())
