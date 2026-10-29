import { Global, Module } from '@nestjs/common';
import { ENV, type Env } from '../config/env.js';
import { AdminTemplatesController } from './admin-templates.controller.js';
import { NotificationDeliveryService } from './delivery.service.js';
import { DevicesController } from './devices.controller.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { DevLogPushProvider } from './push/dev-log.provider.js';
import { FcmPushProvider, parseServiceAccount } from './push/fcm.provider.js';
import { PUSH_PROVIDER, type PushProvider } from './push/push-provider.js';

/** Fournisseur push selon la configuration ; le mode développement ne peut pas être construit en production. */
export function pushProviderFactory(env: Env): PushProvider {
  if (env.PUSH_PROVIDER === 'fcm') return new FcmPushProvider(parseServiceAccount(env.FCM_SERVICE_ACCOUNT_B64!));
  if (env.APP_ENV === 'production') throw new Error('Les notifications push simulées sont interdites en production.');
  return new DevLogPushProvider();
}

@Global()
@Module({
  controllers: [NotificationsController, DevicesController, AdminTemplatesController],
  providers: [NotificationsService, NotificationDeliveryService, { provide: PUSH_PROVIDER, inject: [ENV], useFactory: pushProviderFactory }],
  exports: [NotificationsService, NotificationDeliveryService, PUSH_PROVIDER],
})
export class NotificationsModule {}
