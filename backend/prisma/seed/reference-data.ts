/**
 * Données de référence nécessaires au fonctionnement de la plateforme (pas des données de démonstration).
 * Le seed est idempotent : il peut être rejoué sans créer de doublons, et ne modifie pas ce que
 * l'administration a changé ensuite (activation, ordre…), sauf les libellés indiqués comme gérés par le seed.
 */

export const COUNTRY = { code: 'CI', name: 'Côte d’Ivoire', currency: 'XOF', phonePrefix: '+225' } as const;

/** Centre approximatif d'Abidjan (Plateau). */
export const CITY = { name: 'Abidjan', timezone: 'Africa/Abidjan', lng: -4.0197, lat: 5.3236 } as const;

/**
 * Communes du district d'Abidjan. Centroïdes APPROXIMATIFS (précision de l'ordre du kilomètre), à remplacer
 * par les contours officiels depuis l'administration (module Zones géographiques) avant la mise en production.
 */
export const COMMUNES: { name: string; lng: number; lat: number }[] = [
  { name: 'Abobo', lng: -4.0167, lat: 5.4167 },
  { name: 'Adjamé', lng: -4.0228, lat: 5.3667 },
  { name: 'Anyama', lng: -4.0517, lat: 5.495 },
  { name: 'Attécoubé', lng: -4.04, lat: 5.335 },
  { name: 'Bingerville', lng: -3.885, lat: 5.355 },
  { name: 'Cocody', lng: -3.97, lat: 5.36 },
  { name: 'Koumassi', lng: -3.95, lat: 5.2917 },
  { name: 'Marcory', lng: -3.9833, lat: 5.3 },
  { name: 'Plateau', lng: -4.0197, lat: 5.3236 },
  { name: 'Port-Bouët', lng: -3.9264, lat: 5.2539 },
  { name: 'Songon', lng: -4.26, lat: 5.32 },
  { name: 'Treichville', lng: -4.005, lat: 5.2933 },
  { name: 'Yopougon', lng: -4.08, lat: 5.34 },
];

export const PERMISSIONS: Record<string, string> = {
  'dashboard.read': 'Consulter le tableau de bord',
  'user.read': 'Consulter les comptes clients',
  'user.suspend': 'Suspendre ou réactiver un compte',
  'user.revoke_sessions': 'Déconnecter un utilisateur de tous ses appareils',
  'pro.read': 'Consulter les professionnels',
  'pro.verify': 'Valider, refuser ou demander des compléments sur un dossier professionnel',
  'pro.suspend': 'Suspendre ou réactiver un professionnel',
  'document.read_private': 'Consulter les documents privés de vérification (accès journalisé)',
  'catalog.write': 'Gérer catégories, prestations et tarifs de référence',
  'geo.write': 'Gérer villes, communes et quartiers',
  'request.read': 'Consulter les demandes',
  'mission.read': 'Consulter les missions',
  'mission.intervene': 'Intervenir sur une mission (annulation, litige)',
  'quote.read': 'Consulter les devis',
  'payment.read': 'Consulter les paiements',
  'refund.approve': 'Approuver un remboursement',
  'commission.write': 'Modifier les règles de commission',
  'payout.approve': 'Valider un reversement',
  'review.moderate': 'Modérer les avis',
  'complaint.handle': 'Traiter les réclamations',
  'report.handle': 'Traiter les signalements',
  'promotion.write': 'Gérer les promotions',
  'notification.write': 'Gérer les gabarits de notification',
  'stats.read': 'Consulter les statistiques',
  'audit.read': 'Consulter le journal d’audit',
  'settings.write': 'Modifier les paramètres et règles d’attribution',
  'admin.manage': 'Gérer les comptes administrateurs et leurs rôles',
};

const ALL = Object.keys(PERMISSIONS);

export const ROLES: { code: string; label: string; permissions: string[] }[] = [
  { code: 'CLIENT', label: 'Client', permissions: [] },
  { code: 'PRO', label: 'Professionnel', permissions: [] },
  { code: 'ADMIN_SUPER', label: 'Super-administrateur', permissions: ALL },
  {
    code: 'ADMIN_OPS',
    label: 'Opérations',
    permissions: ['dashboard.read', 'user.read', 'pro.read', 'pro.verify', 'pro.suspend', 'document.read_private', 'request.read', 'mission.read', 'mission.intervene', 'quote.read', 'catalog.write', 'geo.write', 'stats.read'],
  },
  {
    code: 'ADMIN_FINANCE',
    label: 'Finance',
    permissions: ['dashboard.read', 'mission.read', 'quote.read', 'payment.read', 'refund.approve', 'commission.write', 'payout.approve', 'promotion.write', 'stats.read'],
  },
  {
    code: 'ADMIN_SUPPORT',
    label: 'Assistance',
    permissions: ['dashboard.read', 'user.read', 'user.revoke_sessions', 'pro.read', 'request.read', 'mission.read', 'quote.read', 'payment.read', 'complaint.handle'],
  },
  {
    code: 'ADMIN_MODERATION',
    label: 'Modération',
    permissions: ['dashboard.read', 'user.read', 'user.suspend', 'pro.read', 'review.moderate', 'report.handle'],
  },
];

export interface CategorySeed {
  slug: string;
  name: string;
  iconKey: string;
  searchTerms: string[];
  skills: string[];
  services: { slug: string; name: string }[];
}

/**
 * Catalogue initial. Toutes les prestations sont « sur devis » et sans tarif de référence :
 * les prix fixes, frais de déplacement et fourchettes doivent être fixés par l'équipe commerciale
 * depuis l'administration (module Tarifs de référence). Aucun prix n'est inventé ici.
 */
export const CATEGORIES: CategorySeed[] = [
  {
    slug: 'plomberie', name: 'Plomberie', iconKey: 'plomberie',
    searchTerms: ['fuite', 'robinet', 'évier', 'wc', 'toilettes', 'chasse d’eau', 'canalisation', 'chauffe-eau', 'douche', 'bouché'],
    skills: ['Recherche de fuite', 'Débouchage', 'Installation sanitaire', 'Chauffe-eau'],
    services: [
      { slug: 'plomberie-fuite', name: 'Fuite d’eau' },
      { slug: 'plomberie-debouchage', name: 'Débouchage évier ou WC' },
      { slug: 'plomberie-chauffe-eau', name: 'Installation ou réparation de chauffe-eau' },
      { slug: 'plomberie-autre', name: 'Autre besoin en plomberie' },
    ],
  },
  {
    slug: 'electricite', name: 'Électricité', iconKey: 'electricite',
    searchTerms: ['courant', 'panne', 'prise', 'disjoncteur', 'compteur', 'lumière', 'ampoule', 'câblage', 'court-circuit'],
    skills: ['Dépannage', 'Tableau électrique', 'Installation de prises et éclairage'],
    services: [
      { slug: 'electricite-panne', name: 'Panne de courant' },
      { slug: 'electricite-prise-eclairage', name: 'Prise ou éclairage' },
      { slug: 'electricite-tableau', name: 'Tableau électrique ou disjoncteur' },
      { slug: 'electricite-autre', name: 'Autre besoin en électricité' },
    ],
  },
  {
    slug: 'climatisation', name: 'Climatisation', iconKey: 'climatisation',
    searchTerms: ['climatiseur', 'clim', 'split', 'ne refroidit plus', 'recharge gaz', 'entretien clim', 'fuite clim'],
    skills: ['Entretien', 'Recharge de gaz', 'Installation de split'],
    services: [
      { slug: 'climatisation-entretien', name: 'Entretien de climatiseur' },
      { slug: 'climatisation-panne', name: 'Climatiseur en panne' },
      { slug: 'climatisation-installation', name: 'Installation de climatiseur' },
    ],
  },
  {
    slug: 'serrurerie', name: 'Serrurerie', iconKey: 'serrurerie',
    searchTerms: ['serrure', 'clé', 'porte bloquée', 'cadenas', 'porte claquée', 'verrou'],
    skills: ['Ouverture de porte', 'Changement de serrure'],
    services: [
      { slug: 'serrurerie-ouverture', name: 'Ouverture de porte' },
      { slug: 'serrurerie-changement', name: 'Changement de serrure' },
    ],
  },
  {
    slug: 'mecanique-auto', name: 'Mécanique automobile', iconKey: 'mecanique-auto',
    searchTerms: ['voiture', 'garage', 'moteur', 'batterie', 'pneu', 'vidange', 'freins', 'démarre pas'],
    skills: ['Diagnostic', 'Batterie et démarrage', 'Freinage', 'Vidange'],
    services: [
      { slug: 'mecanique-diagnostic', name: 'Diagnostic de panne' },
      { slug: 'mecanique-batterie', name: 'Batterie ou démarrage' },
      { slug: 'mecanique-entretien', name: 'Vidange et entretien' },
    ],
  },
  {
    slug: 'menuiserie', name: 'Menuiserie', iconKey: 'menuiserie',
    searchTerms: ['porte', 'placard', 'meuble', 'bois', 'fenêtre', 'charnière'],
    skills: ['Réparation de meubles', 'Portes et fenêtres', 'Fabrication sur mesure'],
    services: [
      { slug: 'menuiserie-reparation', name: 'Réparation de porte ou meuble' },
      { slug: 'menuiserie-sur-mesure', name: 'Fabrication sur mesure' },
    ],
  },
  {
    slug: 'peinture', name: 'Peinture', iconKey: 'peinture',
    searchTerms: ['peindre', 'mur', 'façade', 'plafond', 'enduit', 'humidité'],
    skills: ['Peinture intérieure', 'Peinture de façade'],
    services: [
      { slug: 'peinture-interieur', name: 'Peinture intérieure' },
      { slug: 'peinture-facade', name: 'Peinture de façade' },
    ],
  },
  {
    slug: 'maconnerie', name: 'Maçonnerie', iconKey: 'maconnerie',
    searchTerms: ['mur', 'fissure', 'béton', 'clôture', 'dalle', 'construction'],
    skills: ['Petits travaux', 'Clôture', 'Réparation de fissures'],
    services: [
      { slug: 'maconnerie-reparation', name: 'Réparation (fissure, mur)' },
      { slug: 'maconnerie-travaux', name: 'Petits travaux de maçonnerie' },
    ],
  },
  {
    slug: 'electromenager', name: 'Électroménager', iconKey: 'electromenager',
    searchTerms: ['frigo', 'réfrigérateur', 'congélateur', 'machine à laver', 'cuisinière', 'micro-ondes'],
    skills: ['Froid', 'Lavage', 'Cuisson'],
    services: [
      { slug: 'electromenager-froid', name: 'Réfrigérateur ou congélateur' },
      { slug: 'electromenager-lavage', name: 'Machine à laver' },
    ],
  },
  {
    slug: 'carrelage', name: 'Carrelage', iconKey: 'carrelage',
    searchTerms: ['carreau', 'faïence', 'sol', 'joint', 'plâtre'],
    skills: ['Pose de carrelage', 'Faïence', 'Plâtrerie'],
    services: [{ slug: 'carrelage-pose', name: 'Pose ou réparation de carrelage' }],
  },
  {
    slug: 'maintenance', name: 'Maintenance', iconKey: 'maintenance',
    searchTerms: ['réparation', 'entretien', 'bricolage', 'groupe électrogène', 'pompe'],
    skills: ['Petites réparations', 'Groupe électrogène', 'Pompe à eau'],
    services: [{ slug: 'maintenance-generale', name: 'Maintenance et petites réparations' }],
  },
  {
    slug: 'autres', name: 'Autres services', iconKey: 'autres',
    searchTerms: ['autre', 'divers'],
    skills: [],
    services: [{ slug: 'autres-besoin', name: 'Autre besoin' }],
  },
];

export const VERIFICATION_DOCUMENT_TYPES: { code: string; label: string; requiredFor: ('INDIVIDUAL' | 'COMPANY')[] }[] = [
  { code: 'PIECE_IDENTITE', label: 'Pièce d’identité (CNI, passeport ou carte consulaire)', requiredFor: ['INDIVIDUAL', 'COMPANY'] },
  { code: 'RCCM', label: 'Registre du commerce (RCCM)', requiredFor: ['COMPANY'] },
  { code: 'CASIER_JUDICIAIRE', label: 'Extrait de casier judiciaire', requiredFor: [] },
  { code: 'DIPLOME', label: 'Diplôme ou attestation de formation', requiredFor: [] },
];

/** Règles d'attribution par défaut (toutes villes, toutes catégories), modifiables depuis l'administration. */
export const DEFAULT_DISPATCH_RULES = [
  {
    mode: 'URGENT', strategy: 'FIRST_ACCEPT', initialRadiusM: 3000, radiusStepM: 3000, maxRadiusM: 15000,
    prosPerWave: 5, waveIntervalS: 60, offerTtlS: 60, reservationTtlS: 120, clientConfirmTtlS: 120, maxOffersShown: 1,
  },
  {
    mode: 'SCHEDULED', strategy: 'CLIENT_CHOICE', initialRadiusM: 5000, radiusStepM: 5000, maxRadiusM: 20000,
    prosPerWave: 10, waveIntervalS: 600, offerTtlS: 7200, reservationTtlS: 900, clientConfirmTtlS: 3600, maxOffersShown: 5,
  },
] as const;

export const SETTINGS: { key: string; value: unknown; description: string }[] = [
  { key: 'mission.auto_close_hours', value: 48, description: 'Délai de clôture automatique après la fin déclarée par le professionnel' },
  { key: 'location.ping_retention_days', value: 30, description: 'Conservation des positions de trajet après clôture' },
  { key: 'messages.retention_months', value: 12, description: 'Conservation des messages après clôture' },
  { key: 'otp.ttl_minutes', value: 10, description: 'Durée de validité d’un code SMS' },
  { key: 'otp.max_attempts', value: 5, description: 'Nombre d’essais par code' },
  { key: 'upload.max_photo_mb', value: 10, description: 'Taille maximale d’une photo' },
  { key: 'request.max_photos', value: 5, description: 'Nombre maximal de photos par demande' },
  { key: 'request.max_voice_seconds', value: 120, description: 'Durée maximale d’une note vocale' },
  { key: 'geo.service_area_radius_m', value: 40000, description: 'Distance maximale au centre d’une ville active pour être desservi (tant que les contours ne sont pas saisis)' },
  { key: 'pro.location_fresh_minutes', value: 30, description: 'Durée pendant laquelle la dernière position d’un professionnel disponible est utilisée' },
  { key: 'search.eta_speed_kmh', value: 18, description: 'Vitesse moyenne en ville pour estimer le délai d’arrivée' },
  { key: 'search.eta_departure_minutes', value: 10, description: 'Temps de préparation ajouté à l’estimation du délai d’arrivée' },
  { key: 'request.max_active_per_client', value: 3, description: 'Nombre de demandes en cours par client' },
  { key: 'request.max_schedule_days', value: 30, description: 'Délai maximal pour programmer une intervention' },
  { key: 'request.min_schedule_lead_minutes', value: 60, description: 'Délai minimal avant le début d’une intervention programmée' },
  { key: 'address.max_per_user', value: 10, description: 'Nombre d’adresses enregistrées par client' },
  { key: 'dispatch.urgent_max_minutes', value: 30, description: 'Durée maximale de recherche d’un professionnel pour une urgence' },
  { key: 'mission.reassign_on_pro_cancel', value: true, description: 'Relancer la recherche quand un professionnel se désiste avant l’intervention' },
  { key: 'quote.default_validity_hours', value: 48, description: 'Durée de validité d’un devis sans autre précision du professionnel' },
  { key: 'quote.max_total_xof', value: 5_000_000, description: 'Montant maximal d’un devis (F CFA)' },
  { key: 'payment.checkout_ttl_minutes', value: 30, description: 'Durée pendant laquelle une page de paiement reste utilisable' },
  { key: 'payment.reminder_minutes', value: 15, description: 'Relance du client qui n’a pas payé après ce délai' },
  { key: 'payment.timeout_minutes', value: 120, description: 'Annulation sans frais d’une mission non payée avant le déplacement du professionnel' },
  { key: 'review.window_days', value: 30, description: 'Délai pour donner son avis après la clôture d’une mission' },
  { key: 'messages.write_after_close_days', value: 7, description: 'Délai pendant lequel la conversation reste ouverte après la fin de la mission' },
  { key: 'app.min_version.client', value: '0.1.0', description: 'Version minimale de l’application client' },
  { key: 'app.min_version.pro', value: '0.1.0', description: 'Version minimale de l’application professionnel' },
];

/**
 * Règle de commission par défaut (décision D9 : taux unique, hors matériaux et hors déplacement).
 * VALEUR PROVISOIRE de 10 % en attendant le taux validé ; créée seulement si aucune règle par défaut n'existe,
 * puis modifiable dans l'administration (permission commission.write).
 */
export const DEFAULT_COMMISSION_RULE = { rateBps: 1000, minXof: 0n, appliesToTravelFee: false } as const;
