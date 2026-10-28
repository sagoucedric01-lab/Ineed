import { describe, expect, it } from 'vitest';
import { missingRequirements, VERIFICATION_TRANSITIONS } from './pro-requirements.js';

const complete = {
  kind: 'INDIVIDUAL' as const, hasNames: true, businessName: 'Koffi Plomberie', companyRegNumber: null,
  categoryCount: 1, zoneCount: 2, hoursCount: 6, hasPhoto: true,
  documentTypes: ['PIECE_IDENTITE'], requiredDocumentTypes: ['PIECE_IDENTITE'],
};

describe('missingRequirements', () => {
  it('dossier complet : rien ne manque', () => expect(missingRequirements(complete)).toEqual([]));
  it('liste chaque élément manquant', () => {
    expect(missingRequirements({ ...complete, hasNames: false, businessName: '  ', categoryCount: 0, zoneCount: 0, hoursCount: 0, hasPhoto: false, documentTypes: [] }))
      .toEqual(['NAMES', 'BUSINESS_NAME', 'CATEGORY', 'ZONE', 'HOURS', 'PHOTO', 'DOCUMENT:PIECE_IDENTITE']);
  });
  it('une entreprise doit fournir son RCCM (numéro et document)', () => {
    expect(missingRequirements({ ...complete, kind: 'COMPANY', requiredDocumentTypes: ['PIECE_IDENTITE', 'RCCM'] }))
      .toEqual(['COMPANY_REG_NUMBER', 'DOCUMENT:RCCM']);
  });
});

describe('transitions de vérification', () => {
  it('seul un dossier soumis peut être validé, refusé ou renvoyé pour compléments', () => {
    for (const a of ['approve', 'reject', 'requestInfo'] as const) expect(VERIFICATION_TRANSITIONS[a].from).toEqual(['SUBMITTED']);
  });
  it('un dossier refusé ne peut pas être soumis de nouveau sans l’assistance', () => {
    expect(VERIFICATION_TRANSITIONS.submit.from).not.toContain('REJECTED');
  });
});
