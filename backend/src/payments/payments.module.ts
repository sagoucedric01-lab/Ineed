import { Module } from '@nestjs/common';
import { MissionsModule } from '../missions/missions.module.js';
import {
  AdminPaymentsController, MissionPaymentsController, PaymentNotificationsController, PaymentReturnController, PaymentsController, ProEarningsController, SandboxCheckoutController,
} from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { ReceiptsService } from './receipts.service.js';

@Module({
  imports: [MissionsModule],
  controllers: [MissionPaymentsController, PaymentsController, PaymentNotificationsController, PaymentReturnController, SandboxCheckoutController, ProEarningsController, AdminPaymentsController],
  providers: [PaymentsService, ReceiptsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
