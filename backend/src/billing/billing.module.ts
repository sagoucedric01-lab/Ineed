import { Global, Module } from '@nestjs/common';
import { ENV, type Env } from '../config/env.js';
import { RedisService } from '../infra/redis.service.js';
import { BillingService } from './billing.service.js';
import { LedgerService } from './ledger.service.js';
import { CinetPayProvider } from './providers/cinetpay.provider.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from './providers/payment-provider.js';
import { SandboxPaymentProvider } from './providers/sandbox.provider.js';
import { RefundsService } from './refunds.service.js';

/** Prestataire de paiement selon la configuration. Le simulateur ne peut pas être construit en production. */
export function paymentProviderFactory(env: Env, redis: RedisService): PaymentProvider {
  switch (env.PAYMENT_PROVIDER) {
    case 'sandbox':
      if (env.APP_ENV === 'production') throw new Error('Le simulateur de paiement est interdit en production.');
      return new SandboxPaymentProvider(redis.client, env.PUBLIC_API_URL ?? '', Buffer.from(env.DATA_ENCRYPTION_KEY_B64, 'base64'));
    case 'cinetpay':
      return new CinetPayProvider({ apiUrl: env.CINETPAY_API_URL, apiKey: env.CINETPAY_API_KEY!, siteId: env.CINETPAY_SITE_ID!, secretKey: env.CINETPAY_SECRET_KEY! });
    default:
      throw new Error(`Prestataire de paiement non disponible : ${env.PAYMENT_PROVIDER}`);
  }
}

/** Argent : prestataire de paiement, montants dus, commissions, grand livre et remboursements. */
@Global()
@Module({
  providers: [
    { provide: PAYMENT_PROVIDER, inject: [ENV, RedisService], useFactory: paymentProviderFactory },
    BillingService,
    LedgerService,
    RefundsService,
  ],
  exports: [PAYMENT_PROVIDER, BillingService, LedgerService, RefundsService],
})
export class BillingModule {}
