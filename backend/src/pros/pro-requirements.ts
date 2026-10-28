/** Éléments manquants pour soumettre un dossier professionnel (affichés par l'application comme une liste à compléter). */
export type MissingItem =
  | 'NAMES'
  | 'BUSINESS_NAME'
  | 'COMPANY_REG_NUMBER'
  | 'CATEGORY'
  | 'ZONE'
  | 'HOURS'
  | 'PHOTO'
  | `DOCUMENT:${string}`;

export interface RequirementInput {
  kind: 'INDIVIDUAL' | 'COMPANY';
  hasNames: boolean;
  businessName: string | null;
  companyRegNumber: string | null;
  categoryCount: number;
  zoneCount: number;
  hoursCount: number;
  hasPhoto: boolean;
  /** Types de documents déposés et non refusés. */
  documentTypes: string[];
  /** Types obligatoires pour ce type de compte. */
  requiredDocumentTypes: string[];
}

export function missingRequirements(p: RequirementInput): MissingItem[] {
  const missing: MissingItem[] = [];
  if (!p.hasNames) missing.push('NAMES');
  if (!p.businessName?.trim()) missing.push('BUSINESS_NAME');
  if (p.kind === 'COMPANY' && !p.companyRegNumber?.trim()) missing.push('COMPANY_REG_NUMBER');
  if (p.categoryCount === 0) missing.push('CATEGORY');
  if (p.zoneCount === 0) missing.push('ZONE');
  if (p.hoursCount === 0) missing.push('HOURS');
  if (!p.hasPhoto) missing.push('PHOTO');
  for (const t of p.requiredDocumentTypes) if (!p.documentTypes.includes(t)) missing.push(`DOCUMENT:${t}`);
  return missing;
}

/** Transitions du statut de vérification autorisées, et l'acteur qui peut les déclencher. */
export const VERIFICATION_TRANSITIONS = {
  submit: { from: ['DRAFT', 'INFO_REQUESTED'], to: 'SUBMITTED' },
  approve: { from: ['SUBMITTED'], to: 'APPROVED' },
  reject: { from: ['SUBMITTED'], to: 'REJECTED' },
  requestInfo: { from: ['SUBMITTED'], to: 'INFO_REQUESTED' },
  suspend: { from: ['APPROVED'], to: 'SUSPENDED' },
  reactivate: { from: ['SUSPENDED'], to: 'APPROVED' },
} as const;

export type VerificationAction = keyof typeof VERIFICATION_TRANSITIONS;

/** Statuts dans lesquels le professionnel peut encore modifier son dossier. */
export const EDITABLE_STATUSES = ['DRAFT', 'INFO_REQUESTED'] as const;
