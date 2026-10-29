import { Body, Controller, Get, Header, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import type { AuthUser } from '../auth/auth-user.js';
import { Access, AdminOnly, CurrentUser, Public } from '../auth/decorators.js';
import { LedgerService } from '../billing/ledger.service.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../billing/providers/payment-provider.js';
import { SandboxPaymentProvider } from '../billing/providers/sandbox.provider.js';
import { RefundsService } from '../billing/refunds.service.js';
import { paymentView } from '../billing/views.js';
import { AppError } from '../common/http/api-error.js';
import { auditContext, type AppRequest } from '../common/http/request-context.js';
import { IDEMPOTENCY_HEADER, Idempotent } from '../common/idempotency/idempotency.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from '../infra/prisma.service.js';
import { AdminPaymentsQueryDto, AdminRefundDto, CompleteRefundDto, SandboxDecisionDto } from './dto.js';
import { PaymentsService } from './payments.service.js';
import { ReceiptsService } from './receipts.service.js';
import { paymentReturnPage, sandboxCheckoutPage, sandboxResultPage } from './sandbox-page.js';

const idempotencyHeader = { name: 'Idempotency-Key', required: true, description: 'Clé unique par action (renvoyée telle quelle en cas de nouvel essai)' };
const headerKey = (req: AppRequest) => String(req.headers[IDEMPOTENCY_HEADER]);

@ApiTags('Paiements')
@ApiBearerAuth()
@Access({ app: 'CLIENT' })
@Controller('v1/missions/:missionId/payments')
export class MissionPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Param('missionId', ParseUUIDPipe) missionId: string) {
    return this.payments.listForMission(user.userId, missionId);
  }

  @Post()
  @Idempotent()
  @ApiHeader(idempotencyHeader)
  @ApiOperation({ summary: 'Payer ce qui est dû (montant calculé par le serveur) : renvoie la page de paiement du prestataire' })
  initiate(@CurrentUser() user: AuthUser, @Param('missionId', ParseUUIDPipe) missionId: string, @Req() req: AppRequest) {
    return this.payments.initiate(user.userId, missionId, headerKey(req));
  }
}

@ApiTags('Paiements')
@ApiBearerAuth()
@Access({ app: 'CLIENT' })
@Controller('v1/payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly receipts: ReceiptsService,
  ) {}

  @Get(':id')
  @ApiOperation({ summary: 'État du paiement, vérifié auprès du prestataire s’il est en attente (seul le serveur confirme un paiement)' })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.getForClient(user.userId, id);
  }

  @Get(':id/receipt')
  @ApiOperation({ summary: 'Reçu d’un paiement confirmé' })
  receipt(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.receipts.receipt(user.userId, id);
  }
}

/** Notifications des prestataires (webhooks) : publiques, authentifiées par leur signature. */
@ApiTags('Paiements — notifications du prestataire')
@Controller('v1/payments/notify')
export class PaymentNotificationsController {
  constructor(private readonly payments: PaymentsService) {}

  @Public()
  @Post(':provider')
  @HttpCode(200)
  @ApiOperation({ summary: 'Notification de paiement (signature vérifiée ; le résultat est ensuite contrôlé auprès du prestataire)' })
  notify(@Param('provider') provider: string, @Headers() headers: Record<string, string>, @Body() body: unknown) {
    return this.payments.handleNotification(provider, headers, body);
  }

  @Public()
  @Get(':provider')
  @ApiOperation({ summary: 'Contrôle de disponibilité de l’adresse de notification par le prestataire' })
  ping() {
    return { ok: true };
  }
}

@ApiExcludeController()
@Controller('v1/payment-return')
export class PaymentReturnController {
  @Public()
  @Get()
  @Header('content-type', 'text/html; charset=utf-8')
  page() {
    return paymentReturnPage();
  }
}

/** Page de paiement SIMULÉE : n'existe qu'avec le simulateur (jamais en production). */
@ApiExcludeController()
@Controller('v1/payments/sandbox/checkout')
export class SandboxCheckoutController {
  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(ENV) private readonly env: Env,
    private readonly payments: PaymentsService,
    private readonly prisma: PrismaService,
  ) {}

  private sandbox(): SandboxPaymentProvider {
    if (!(this.provider instanceof SandboxPaymentProvider) || this.env.APP_ENV === 'production') throw new AppError(404, 'NOT_FOUND', 'Page introuvable.');
    return this.provider;
  }

  @Public()
  @Get(':ref')
  @Header('content-type', 'text/html; charset=utf-8')
  @Header('cache-control', 'no-store')
  async page(@Param('ref') ref: string) {
    const s = await this.sandbox().state(ref);
    if (!s) return sandboxResultPage('UNKNOWN');
    return sandboxCheckoutPage(ref, BigInt(s.amountXof), s.description, s.status);
  }

  @Public()
  @Post(':ref')
  @HttpCode(200)
  @Header('content-type', 'text/html; charset=utf-8')
  @Header('cache-control', 'no-store')
  async decide(@Param('ref') ref: string, @Body() dto: SandboxDecisionDto) {
    const sandbox = this.sandbox();
    const s = await sandbox.decide(ref, dto.outcome, dto.method ?? 'ORANGE_MONEY');
    if (!s) return sandboxResultPage('UNKNOWN');
    // Comme un vrai prestataire : notification signée envoyée au serveur, qui vérifie ensuite le paiement.
    const n = sandbox.signedNotification(ref, randomUUID());
    if (await this.prisma.payment.findUnique({ where: { merchantReference: ref } })) await this.payments.handleNotification('sandbox', n.headers, n.body);
    return sandboxResultPage(s.status);
  }
}

@ApiTags('Professionnel — revenus')
@ApiBearerAuth()
@Access({ app: 'PRO', roles: ['PRO'] })
@Controller('v1/pro/earnings')
export class ProEarningsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Get()
  @ApiOperation({ summary: 'Montant dû par mission (après commission et remboursements), en attente ou disponible' })
  get(@CurrentUser() user: AuthUser) {
    return this.receipts.earnings(user.userId);
  }
}

@ApiTags('Administration — paiements')
@ApiBearerAuth()
@Controller('v1/admin')
export class AdminPaymentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly refunds: RefundsService,
  ) {}

  @Get('payments')
  @AdminOnly('payment.read')
  async list(@Query() q: AdminPaymentsQueryDto) {
    const page = q.page ?? 1;
    const rows = await this.prisma.payment.findMany({
      where: { missionId: q.missionId, status: q.status },
      orderBy: { initiatedAt: 'desc' },
      skip: (page - 1) * 50,
      take: 50,
      include: { refunds: true, commission: true, mission: { select: { reference: true } } },
    });
    return rows.map((p) => ({ ...paymentView(p), merchantReference: p.merchantReference, providerTxnId: p.providerTxnId, isDuplicate: p.isDuplicate, failureCode: p.failureCode, missionId: p.missionId, missionReference: p.mission.reference, commissionXof: p.commission ? Number(p.commission.amountXof) : null }));
  }

  @Get('ledger/balances')
  @AdminOnly('payment.read')
  @ApiOperation({ summary: 'Rapprochement : soldes par compte du grand livre (leur somme vaut toujours 0)' })
  async balances() {
    const b = await this.ledger.balances();
    return { accounts: Object.fromEntries(Object.entries(b.accounts).map(([k, v]) => [k, Number(v)])), total: Number(b.total), entries: Number(b.entries), balanced: b.total === 0n };
  }

  @Post('payments/:id/refunds')
  @AdminOnly('refund.approve')
  @Idempotent()
  @ApiHeader(idempotencyHeader)
  @ApiOperation({ summary: 'Rembourser tout ou partie d’un paiement (plafonné au montant payé ; journalisé)' })
  async refund(@CurrentUser() user: AuthUser, @Req() req: AppRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminRefundDto) {
    const r = await this.refunds.adminRefund({ ...auditContext(req), actorId: user.userId }, id, BigInt(dto.amountXof), dto.reason, headerKey(req));
    return { id: r.id, status: r.status, amountXof: Number(r.amountXof) };
  }

  @Post('refunds/:id/complete')
  @HttpCode(200)
  @AdminOnly('refund.approve')
  @ApiOperation({ summary: 'Déclarer exécuté un remboursement fait dans l’espace marchand du prestataire' })
  async complete(@CurrentUser() user: AuthUser, @Req() req: AppRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteRefundDto) {
    const r = await this.refunds.completeManual({ ...auditContext(req), actorId: user.userId }, id, dto.providerRefundId);
    return { id: r.id, status: r.status, amountXof: Number(r.amountXof), providerRefundId: r.providerRefundId };
  }
}
