# Système de design Ineed

Source unique de l'identité visuelle et des textes des trois interfaces (Ineed, Ineed Pro, administration).
**Ne pas dupliquer ces valeurs dans le code applicatif** : les applications consomment les fichiers générés.

## Contenu

| Dossier / fichier | Rôle |
|---|---|
| `tokens.json` | Couleurs (palette + rôles pour les thèmes clair et sombre), typographie, espacements, rayons, ombres, tailles, animations, paires de contraste à vérifier |
| `generated/flutter/ineed_tokens.dart` | Tokens pour Flutter (`IneedColorScheme.light/dark`, `IneedTypography`, `IneedSpacing`…) — **généré** |
| `generated/web/tokens.css`, `tailwind-preset.cjs` | Variables CSS (`--in-*`, thèmes clair/sombre) et preset Tailwind pour l'admin — **générés** |
| `brand/` | Symbole, logo horizontal (positif/négatif), icônes d'application client et pro, avant-plan Android adaptatif ; exports PNG dans `brand/png/` |
| `icons/categories/` | 12 icônes de métiers (24 px, trait 1,75, `currentColor`) ; le nom de fichier correspond à `categories.icon_key` en base |
| `icons/ui/` | 20 icônes d'interface du même style |
| `copy/common_fr.arb`, `client_fr.arb`, `pro_fr.arb` | Textes des applications mobiles (format ARB Flutter, pluriels ICU) |
| `copy/admin_fr.json` | Textes de l'administration |
| `copy/notifications_fr.json` | Gabarits initiaux des notifications push/SMS (chargés en base, modifiables dans l'admin) |
| `maquettes/src.html` → `index.html` | Maquettes des écrans clés, construites avec les vrais tokens, icônes et textes |
| `maquettes/png/` | Captures de chaque écran en thème clair et sombre |
| `scripts/` | Génération, contrôles et rendu (voir ci-dessous) |

## Commandes

```bash
cd design
node scripts/build-tokens.mjs        # régénère Dart / CSS / Tailwind depuis tokens.json
node scripts/check-copy.mjs --fix    # corrige la typographie française des textes
node scripts/build-maquettes.mjs     # assemble maquettes/index.html
node scripts/render.mjs              # exporte icônes et écrans en PNG (Chromium via Playwright)
pnpm run check                       # contrastes + textes + fichiers générés à jour + tests unitaires
bash scripts/check-flutter.sh        # compile les tokens Dart et passe les ARB dans `flutter gen-l10n`
```

`pnpm run check` et `check-flutter.sh` seront exécutés par la CI à partir de la phase 3.

## Principes

1. **Confiance avant tout.** Le badge « Identité vérifiée par Ineed » n'est affiché que si la vérification a réellement eu lieu. Les distances sont toujours « environ ». Un paiement n'est « confirmé » qu'après validation du serveur.
2. **L'orange signale l'urgence, et seulement elle.** Bouton « Intervention immédiate », alertes urgentes côté pro. Toutes les autres actions principales sont en bleu action. Le texte sur orange est toujours bleu nuit (6,5:1), jamais blanc (2,6:1, insuffisant).
3. **Une action principale par écran**, en bas, pleine largeur, 52 px de haut (cible tactile ≥ 48 px).
4. **Jamais d'impasse.** Chaque état vide ou d'erreur propose une action (élargir la zone, réessayer, compléter le dossier).
5. **Parler comme un artisan de confiance** : phrases courtes, vocabulaire du quotidien (« Je pars », « Je suis arrivé »), pas de jargon technique. Les erreurs disent ce qui s'est passé et quoi faire.

## Couleurs

| Rôle | Clair | Sombre | Usage |
|---|---|---|---|
| `primary` | Bleu nuit `#0B2A5B` | `#123A7A` | En-têtes, marque, solde |
| `action` | Bleu `#1F5EFF` | `#6F95FF` | Boutons principaux, liens |
| `urgent` | Orange `#FF7A1A` | `#FF7A1A` | Urgence uniquement, texte `onUrgent` bleu nuit |
| `success` | Vert `#0B7A3B` | `#4CC97F` | Validé, payé, vérifié |
| `danger` | Rouge `#B42318` | `#F97066` | Erreurs, annulation |
| `warningSoft` | Ambre `#FFF1DB` | — | Avertissements, bandeau « paiement de test » |

Toutes les paires texte/fond déclarées dans `tokens.json` respectent WCAG AA (4,5:1) dans les deux thèmes — vérifié par `scripts/check-contrast.mjs`.
Exceptions documentées, non textuelles : l'orange plein sur fond blanc (2,6:1) est un fond de bouton dont le libellé porte le sens ; les étoiles de note (1,9:1) sont toujours accompagnées de la note chiffrée.

## Typographie

- **Plus Jakarta Sans** (titres, montants) et **Inter** (texte) : polices libres (licence SIL OFL), embarquées dans les applications en phase 3 (aucun appel réseau à l'exécution).
- Échelle : 28 / 22 / 18 / 16 / 14 / 12 px. Rien en dessous de 12 px. Les tailles suivent le réglage d'accessibilité du téléphone (jusqu'à 200 %).
- Montants : chiffres tabulaires, format `17 500 F CFA` (espace insécable), sans décimales.

## Logo provisoire

Un « i » minuscule dont le point est un repère de localisation : la personne et l'endroit où elle a besoin d'aide.
L'icône **Ineed Pro** inverse les couleurs (fond orange) et porte une pastille « PRO », pour distinguer les deux applications sur l'écran d'accueil.
Le mot-symbole utilise du texte SVG : avant usage imprimé ou sur un site, un graphiste devra le vectoriser (conversion en tracés) et faire une recherche d'antériorité de marque.

## Textes

- 696 textes au total, rédigés en français, sans texte factice.
- Typographie française imposée par `check-copy.mjs` : apostrophe typographique, espace insécable avant `; : ! ?` et dans les guillemets.
- Les paramètres (`{amount}`, `{proName}`) et pluriels ICU sont validés par `flutter gen-l10n`.
- Les montants, dates et distances sont formatés dans le code (paquet `ineed_core`), pas dans les textes.
