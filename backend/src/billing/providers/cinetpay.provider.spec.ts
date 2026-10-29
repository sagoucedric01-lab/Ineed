import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CINETPAY_TOKEN_FIELDS, CinetPayProvider, mapCheckResponse, sanitizeDescription } from './cinetpay.provider.js';
import { ProviderUnavailableError } from './payment-provider.js';

/**
 * Tests de contrat de l'adaptateur CinetPay sur des réponses au format de la documentation publique.
 * Ils ne remplacent pas un essai sur le compte de test du marchand (non fourni à ce jour).
 */
const cfg = { apiUrl: 'https://api-checkout.cinetpay.test', apiKey: 'KEY', siteId: '105', secretKey: 'SECRET' };

function fakeFetch(responses: Record<string, unknown>, calls: { url: string; body: Record<string, unknown> }[] = []): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(init?.body as string) as Record<string, unknown> });
    const path = new URL(url).pathname;
    const r = responses[path];
    if (r instanceof Error) throw r;
    return new Response(typeof r === 'string' ? r : JSON.stringify(r), { status: 200 });
  }) as unknown as typeof fetch;
}

const notification = {
  cpm_site_id: '105', cpm_trans_id: 'INP2026000001ABCD', cpm_trans_date: '2026-10-29 10:00:00', cpm_amount: '20000', cpm_currency: 'XOF',
  signature: 'abc', payment_method: 'OMCIV2', cel_phone_num: '0700000000', cpm_phone_prefixe: '225', cpm_language: 'fr', cpm_version: 'V4',
  cpm_payment_config: 'SINGLE', cpm_page_action: 'PAYMENT', cpm_custom: '', cpm_designation: 'Mission IN-2026-000001', cpm_error_message: '',
};
const token = (b: Record<string, string>, key = 'SECRET') => createHmac('sha256', key).update(CINETPAY_TOKEN_FIELDS.map((k) => b[k] ?? '').join('')).digest('hex');

describe('adaptateur CinetPay (contrat)', () => {
  it('création : envoie le montant entier en XOF, la référence et les adresses ; renvoie la page de paiement', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const p = new CinetPayProvider(cfg, fakeFetch({ '/v2/payment': { code: '201', message: 'CREATED', data: { payment_token: 'tok', payment_url: 'https://checkout.cinetpay.com/payment/tok' } } }, calls));
    const r = await p.initiate({ merchantReference: 'INP2026000001ABCD', amountXof: 20000n, description: 'Mission IN-2026-000001 · Plomberie & co', customerPhoneE164: '+2250700000000', customerFirstName: 'Awa', notifyUrl: 'https://api.ineed.ci/n', returnUrl: 'https://ineed.ci/r' });
    expect(r.checkoutUrl).toBe('https://checkout.cinetpay.com/payment/tok');
    expect(calls[0]!.url).toBe('https://api-checkout.cinetpay.test/v2/payment');
    expect(calls[0]!.body).toMatchObject({ apikey: 'KEY', site_id: '105', transaction_id: 'INP2026000001ABCD', amount: 20000, currency: 'XOF', notify_url: 'https://api.ineed.ci/n', customer_phone_number: '0700000000' });
    expect(calls[0]!.body.description).toBe('Mission IN-2026-000001 Plomberie co');
  });

  it('création refusée ou réponse illisible : erreur explicite, aucun paiement supposé', async () => {
    await expect(new CinetPayProvider(cfg, fakeFetch({ '/v2/payment': { code: '608', message: 'MINIMUM_REQUIRED_FIELDS' } })).initiate({ merchantReference: 'X', amountXof: 5n, description: 'x', customerPhoneE164: null, customerFirstName: null, notifyUrl: 'n', returnUrl: 'r' })).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(new CinetPayProvider(cfg, fakeFetch({ '/v2/payment/check': '<html>502</html>' })).verify('X')).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(new CinetPayProvider(cfg, fakeFetch({ '/v2/payment/check': new TypeError('fetch failed') })).verify('X')).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it('vérification : accepté, refusé, annulé, en attente', () => {
    const ok = mapCheckResponse({ code: '00', message: 'SUCCES', data: { amount: '20000', currency: 'XOF', status: 'ACCEPTED', payment_method: 'OMCIV2', operator_id: 'MP2610.1234', payment_date: '2026-10-29 10:01:00' } });
    expect(ok).toMatchObject({ status: 'SUCCEEDED', amountXof: 20000n, currency: 'XOF', method: 'ORANGE_MONEY', providerTxnId: 'MP2610.1234', failureCode: null });
    expect(mapCheckResponse({ code: '600', message: 'PAYMENT_FAILED', data: { amount: '20000', currency: 'XOF', status: 'REFUSED', payment_method: 'MOMO' } })).toMatchObject({ status: 'FAILED', method: 'MTN_MOMO', failureCode: '600' });
    expect(mapCheckResponse({ code: '602', message: 'INSUFFICIENT_BALANCE', data: { status: 'REFUSED' } }).failureMessage).toBe('Solde insuffisant sur le compte Mobile Money.');
    expect(mapCheckResponse({ code: '627', message: 'TRANSACTION_CANCEL', data: {} }).status).toBe('CANCELLED');
    expect(mapCheckResponse({ code: '662', message: 'WAITING_CUSTOMER_PAYMENT', data: { status: 'PENDING' } }).status).toBe('PENDING');
    expect(mapCheckResponse({ code: '623', message: 'WAITING_CUSTOMER_TO_VALIDATE', data: {} }).status).toBe('PENDING');
    // Inconnu : jamais un succès.
    expect(mapCheckResponse({ code: '999', message: 'NOUVEAU' }).status).toBe('PENDING');
    expect(mapCheckResponse({ code: '00', message: 'SUCCES', data: { status: 'PENDING' } }).status).toBe('PENDING');
  });

  it('notification : signature x-token vérifiée, site contrôlé, empreinte stable pour dédoublonner', () => {
    const p = new CinetPayProvider(cfg);
    const good = p.parseNotification({ 'x-token': token(notification) }, notification);
    expect(good).toMatchObject({ signatureValid: true, merchantReference: 'INP2026000001ABCD' });
    expect(p.parseNotification({ 'x-token': token(notification) }, { ...notification }).eventId).toBe(good.eventId);
    expect(p.parseNotification({ 'x-token': token(notification, 'AUTRE') }, notification).signatureValid).toBe(false);
    expect(p.parseNotification({}, notification).signatureValid).toBe(false);
    const tampered = { ...notification, cpm_amount: '20' };
    expect(p.parseNotification({ 'x-token': token(notification) }, tampered).signatureValid).toBe(false);
    const otherSite = { ...notification, cpm_site_id: '999' };
    expect(p.parseNotification({ 'x-token': token(otherSite) }, otherSite).signatureValid).toBe(false);
  });

  it('remboursement : opération manuelle déclarée, jamais supposée faite', async () => {
    expect(await new CinetPayProvider(cfg).refund()).toEqual({ status: 'MANUAL' });
  });

  it('description nettoyée des caractères refusés', () => {
    expect(sanitizeDescription('Réparation d’évier #2 / 50%')).toBe('Reparation d evier 2 50');
    expect(sanitizeDescription('###')).toBe('Paiement Ineed');
  });
});
