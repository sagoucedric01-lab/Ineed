import type { MissionStatus, PricingModel } from '../generated/prisma/client.js';

/** Qui déclenche une transition. PAYMENT : confirmation vérifiée côté serveur par le module de paiement (phase 7). */
export type MissionActor = 'CLIENT' | 'PRO' | 'ADMIN' | 'SYSTEM' | 'PAYMENT';

export interface MissionContext {
  pricingModel: PricingModel;
  arrivedAt: Date | null;
  autoCloseAt: Date | null;
  /** Devis (ou supplément) soumis et pas encore accepté ni refusé (phase 7). */
  hasPendingQuote: boolean;
  /** Frais supplémentaires acceptés mais pas encore payés. */
  hasUnpaidSupplement: boolean;
  now: Date;
}

export interface Transition {
  from: MissionStatus;
  to: MissionStatus;
  actors: MissionActor[];
  /** Raison du refus, ou null si la transition est permise dans ce contexte. */
  guard?: (ctx: MissionContext) => string | null;
}

const CANCELLABLE: MissionStatus[] = ['AWAITING_QUOTE', 'QUOTE_PENDING_APPROVAL', 'CONFIRMED', 'PAYMENT_PENDING', 'PAYMENT_CONFIRMED', 'EN_ROUTE', 'ARRIVED'];

/**
 * Table unique des transitions de mission (docs/phase-1/04-parcours-et-etats.md §4.5).
 * Toute paire absente est interdite ; un test énumère toutes les paires pour le vérifier.
 */
export const MISSION_TRANSITIONS: Transition[] = [
  // Devis (phase 7)
  { from: 'AWAITING_QUOTE', to: 'QUOTE_PENDING_APPROVAL', actors: ['PRO'] },
  { from: 'QUOTE_PENDING_APPROVAL', to: 'CONFIRMED', actors: ['CLIENT'], guard: (c) => (c.arrivedAt ? 'Le professionnel est sur place : le devis des travaux mène au paiement.' : null) },
  { from: 'QUOTE_PENDING_APPROVAL', to: 'AWAITING_QUOTE', actors: ['CLIENT', 'SYSTEM'] },
  { from: 'QUOTE_PENDING_APPROVAL', to: 'PAYMENT_PENDING', actors: ['CLIENT'], guard: (c) => (c.arrivedAt ? null : 'Ce devis se valide avant le déplacement du professionnel.') },
  // Paiement (phase 7) : jamais sur simple déclaration d'une application.
  { from: 'CONFIRMED', to: 'PAYMENT_PENDING', actors: ['SYSTEM'] },
  { from: 'PAYMENT_PENDING', to: 'PAYMENT_CONFIRMED', actors: ['PAYMENT'] },
  // Intervention
  { from: 'PAYMENT_CONFIRMED', to: 'EN_ROUTE', actors: ['PRO'], guard: (c) => (c.arrivedAt ? 'Vous êtes déjà sur place.' : null) },
  { from: 'PAYMENT_CONFIRMED', to: 'IN_PROGRESS', actors: ['PRO'], guard: (c) => (c.arrivedAt ? null : 'Indiquez d’abord votre départ puis votre arrivée.') },
  { from: 'EN_ROUTE', to: 'ARRIVED', actors: ['PRO'] },
  {
    from: 'ARRIVED',
    to: 'AWAITING_QUOTE',
    actors: ['SYSTEM'],
    guard: (c) => (c.pricingModel === 'TRAVEL_PLUS_DIAGNOSIS' ? null : 'Seules les interventions avec diagnostic sur place attendent un devis à l’arrivée.'),
  },
  {
    from: 'ARRIVED',
    to: 'IN_PROGRESS',
    actors: ['PRO'],
    guard: (c) => (c.pricingModel === 'TRAVEL_PLUS_DIAGNOSIS' ? 'Le client doit d’abord accepter et payer le devis des travaux.' : null),
  },
  { from: 'IN_PROGRESS', to: 'WORK_COMPLETED', actors: ['PRO'], guard: (c) => (c.hasPendingQuote ? 'Un devis ou des frais supplémentaires attendent la réponse du client.' : c.hasUnpaidSupplement ? 'Les frais supplémentaires acceptés doivent d’abord être payés par le client.' : null) },
  // Clôture
  {
    from: 'WORK_COMPLETED',
    to: 'CLOSED',
    actors: ['CLIENT', 'SYSTEM'],
    guard: (c) => (c.autoCloseAt && c.now < c.autoCloseAt ? 'AUTO_CLOSE_NOT_DUE' : null),
  },
  { from: 'WORK_COMPLETED', to: 'DISPUTED', actors: ['CLIENT'], guard: (c) => (c.autoCloseAt && c.now >= c.autoCloseAt ? 'Le délai pour signaler un problème est dépassé. Ouvrez une réclamation.' : null) },
  { from: 'IN_PROGRESS', to: 'DISPUTED', actors: ['CLIENT', 'PRO'] },
  { from: 'DISPUTED', to: 'CLOSED', actors: ['ADMIN'] },
  // Annulations (barème appliqué par le module de paiement)
  ...CANCELLABLE.map((from): Transition => ({ from, to: 'CANCELLED', actors: from === 'PAYMENT_PENDING' ? ['CLIENT', 'PRO', 'ADMIN', 'SYSTEM'] : ['CLIENT', 'PRO', 'ADMIN'] })),
];

export type TransitionCheck = { ok: true } | { ok: false; reason: string };

export function checkTransition(from: MissionStatus, to: MissionStatus, actor: MissionActor, ctx: MissionContext): TransitionCheck {
  const t = MISSION_TRANSITIONS.find((x) => x.from === from && x.to === to);
  if (!t) return { ok: false, reason: 'TRANSITION_NOT_ALLOWED' };
  if (!t.actors.includes(actor)) return { ok: false, reason: 'ACTOR_NOT_ALLOWED' };
  // Le client confirme lui-même la fin à tout moment ; seule la clôture automatique attend l'échéance.
  if (t.from === 'WORK_COMPLETED' && t.to === 'CLOSED' && actor === 'CLIENT') return { ok: true };
  const refusal = t.guard?.(ctx) ?? null;
  return refusal ? { ok: false, reason: refusal } : { ok: true };
}

/** Statut initial d'une mission selon le modèle de prix figé à la publication de la demande. */
export function initialMissionStatus(pricing: PricingModel): MissionStatus {
  return pricing === 'QUOTE' ? 'AWAITING_QUOTE' : 'CONFIRMED';
}

export type CancellationTerms = 'FREE' | 'TRAVEL_FEE_DUE';

/**
 * Conditions d'une annulation par le client : gratuite tant que le professionnel n'est pas parti ;
 * une fois qu'il s'est déplacé (en route, arrivé, ou devis des travaux en cours après le diagnostic), les
 * frais de déplacement restent dus. Annulation par le professionnel ou l'administration : toujours sans frais
 * pour le client. Les montants sont calculés par le module de remboursement (billing).
 */
export function cancellationTerms(status: MissionStatus, actor: MissionActor, enRouteAt: Date | null = null): CancellationTerms {
  if (actor !== 'CLIENT') return 'FREE';
  if (status === 'EN_ROUTE' || status === 'ARRIVED' || enRouteAt) return 'TRAVEL_FEE_DUE';
  return 'FREE';
}
