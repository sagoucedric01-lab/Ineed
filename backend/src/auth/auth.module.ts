import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ENV, type Env } from '../config/env.js';
import { RateLimiterService } from '../common/rate-limit/rate-limiter.service.js';
import { AccessGuard } from './access.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { DevConsoleOtpProvider } from './otp/dev-console.provider.js';
import { OTP_PROVIDER, type OtpProvider } from './otp/otp-provider.js';
import { OtpService } from './otp/otp.service.js';
import { TwilioVerifyOtpProvider } from './otp/twilio-verify.provider.js';
import { SessionsService } from './sessions.service.js';
import { TokensService } from './tokens.service.js';

export function otpProviderFactory(env: Env): OtpProvider {
  if (env.OTP_PROVIDER === 'twilio_verify') {
    return new TwilioVerifyOtpProvider({
      accountSid: env.TWILIO_ACCOUNT_SID!,
      authToken: env.TWILIO_AUTH_TOKEN!,
      serviceSid: env.TWILIO_VERIFY_SERVICE_SID!,
    });
  }
  return new DevConsoleOtpProvider(env.OTP_PEPPER);
}

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    TokensService,
    SessionsService,
    OtpService,
    AuthService,
    RateLimiterService,
    { provide: OTP_PROVIDER, inject: [ENV], useFactory: otpProviderFactory },
    AccessGuard,
    { provide: APP_GUARD, useExisting: AccessGuard },
  ],
  exports: [TokensService, SessionsService, OtpService, RateLimiterService, OTP_PROVIDER, AccessGuard],
})
export class AuthModule {}
