import { describe, expect, it } from 'vitest';
import type { MissionStatus } from '../generated/prisma/client.js';
import { cancellationTerms, checkTransition, initialMissionStatus, MISSION_TRANSITIONS, type MissionActor, type MissionContext } from './state-machine.js';

const STATUSES: MissionStatus[] = [
  'AWAITING_QUOTE', 'QUOTE_PENDING_APPROVAL', 'CONFIRMED', 'PAYMENT_PENDING', 'PAYMENT_CONFIRMED', 'EN_ROUTE', 'ARRIVED',
  'IN_PROGRESS', 'WORK_COMPLETED', 'CLOSED', 'CANCELLED', 'DISPUTED',
];
const ACTORS: MissionActor[] = ['CLIENT', 'PRO', 'ADMIN', 'SYSTEM', 'PAYMENT'];
const now = new Date('2026-10-29T10:00:00Z');
const ctx = (over: Partial<MissionContext> = {}): MissionContext => ({ pricingModel: 'QUOTE', arrivedAt: null, autoCloseAt: null, hasPendingQuote: false, hasUnpaidSupplement: false, now, ...over });

describe('machine à états des missions', () => {
  it('énumère toutes les paires (de, vers, acteur) : seules les transitions déclarées sont permises', () => {
    let allowed = 0;
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        for (const actor of ACTORS) {
          const declared = MISSION_TRANSITIONS.find((t) => t.from === from && t.to === to);
          // Contexte le plus favorable : seule la déclaration doit décider.
          const contexts = [ctx(), ctx({ arrivedAt: now }), ctx({ pricingModel: 'TRAVEL_PLUS_DIAGNOSIS' }), ctx({ pricingModel: 'TRAVEL_PLUS_DIAGNOSIS', arrivedAt: now })];
          const passes = contexts.some((c) => checkTransition(from, to, actor, c).ok);
          expect(passes, `${from} → ${to} par ${actor}`).toBe(!!declared && declared.actors.includes(actor));
          if (passes) allowed++;
        }
      }
    }
    expect(allowed).toBe(MISSION_TRANSITIONS.reduce((n, t) => n + t.actors.length, 0));
  });

  it('états terminaux : rien ne sort d’une mission annulée ou clôturée', () => {
    for (const to of STATUSES) {
      for (const actor of ACTORS) {
        expect(checkTransition('CANCELLED', to, actor, ctx()).ok).toBe(false);
        expect(checkTransition('CLOSED', to, actor, ctx()).ok).toBe(false);
      }
    }
  });

  it('aucun saut d’étape : pas de travaux sans paiement, pas de fin sans début', () => {
    expect(checkTransition('CONFIRMED', 'IN_PROGRESS', 'PRO', ctx())).toEqual({ ok: false, reason: 'TRANSITION_NOT_ALLOWED' });
    expect(checkTransition('PAYMENT_PENDING', 'EN_ROUTE', 'PRO', ctx()).ok).toBe(false);
    expect(checkTransition('EN_ROUTE', 'WORK_COMPLETED', 'PRO', ctx()).ok).toBe(false);
    expect(checkTransition('CONFIRMED', 'EN_ROUTE', 'PRO', ctx()).ok).toBe(false);
  });

  it('mauvais acteur refusé : le client ne déclare pas l’arrivée, une application ne confirme pas un paiement', () => {
    expect(checkTransition('EN_ROUTE', 'ARRIVED', 'CLIENT', ctx())).toEqual({ ok: false, reason: 'ACTOR_NOT_ALLOWED' });
    expect(checkTransition('PAYMENT_PENDING', 'PAYMENT_CONFIRMED', 'CLIENT', ctx()).ok).toBe(false);
    expect(checkTransition('PAYMENT_PENDING', 'PAYMENT_CONFIRMED', 'PRO', ctx()).ok).toBe(false);
    expect(checkTransition('PAYMENT_PENDING', 'PAYMENT_CONFIRMED', 'PAYMENT', ctx()).ok).toBe(true);
  });

  it('gardes : diagnostic sur place, devis en attente, clôture automatique à échéance', () => {
    expect(checkTransition('ARRIVED', 'IN_PROGRESS', 'PRO', ctx({ pricingModel: 'TRAVEL_PLUS_DIAGNOSIS' })).ok).toBe(false);
    expect(checkTransition('ARRIVED', 'IN_PROGRESS', 'PRO', ctx({ pricingModel: 'FIXED' })).ok).toBe(true);
    expect(checkTransition('PAYMENT_CONFIRMED', 'IN_PROGRESS', 'PRO', ctx({ arrivedAt: now })).ok).toBe(true);
    expect(checkTransition('PAYMENT_CONFIRMED', 'EN_ROUTE', 'PRO', ctx({ arrivedAt: now })).ok).toBe(false);
    expect(checkTransition('IN_PROGRESS', 'WORK_COMPLETED', 'PRO', ctx({ hasPendingQuote: true })).ok).toBe(false);
    expect(checkTransition('IN_PROGRESS', 'WORK_COMPLETED', 'PRO', ctx({ hasUnpaidSupplement: true })).ok).toBe(false);
    const later = new Date(now.getTime() + 3_600_000);
    expect(checkTransition('WORK_COMPLETED', 'CLOSED', 'SYSTEM', ctx({ autoCloseAt: later })).ok).toBe(false);
    expect(checkTransition('WORK_COMPLETED', 'CLOSED', 'SYSTEM', ctx({ autoCloseAt: now })).ok).toBe(true);
    expect(checkTransition('WORK_COMPLETED', 'CLOSED', 'CLIENT', ctx({ autoCloseAt: later })).ok).toBe(true);
    expect(checkTransition('WORK_COMPLETED', 'DISPUTED', 'CLIENT', ctx({ autoCloseAt: now })).ok).toBe(false);
  });

  it('annulation impossible une fois les travaux commencés (litige à la place)', () => {
    for (const actor of ACTORS) expect(checkTransition('IN_PROGRESS', 'CANCELLED', actor, ctx()).ok).toBe(false);
    expect(checkTransition('IN_PROGRESS', 'DISPUTED', 'CLIENT', ctx()).ok).toBe(true);
  });

  it('statut initial selon le modèle de prix, conditions d’annulation', () => {
    expect(initialMissionStatus('QUOTE')).toBe('AWAITING_QUOTE');
    expect(initialMissionStatus('FIXED')).toBe('CONFIRMED');
    expect(initialMissionStatus('TRAVEL_PLUS_DIAGNOSIS')).toBe('CONFIRMED');
    expect(cancellationTerms('CONFIRMED', 'CLIENT')).toBe('FREE');
    expect(cancellationTerms('EN_ROUTE', 'CLIENT')).toBe('TRAVEL_FEE_DUE');
    expect(cancellationTerms('EN_ROUTE', 'PRO')).toBe('FREE');
    // Diagnostic sur place : le professionnel s'est déplacé, même si la mission attend le devis des travaux.
    expect(cancellationTerms('AWAITING_QUOTE', 'CLIENT', new Date())).toBe('TRAVEL_FEE_DUE');
    expect(cancellationTerms('PAYMENT_CONFIRMED', 'ADMIN', new Date())).toBe('FREE');
  });
});
