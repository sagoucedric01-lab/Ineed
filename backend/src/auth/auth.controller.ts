import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { clientIp, type AppRequest } from '../common/http/request-context.js';
import { AuthService } from './auth.service.js';
import { CurrentUser, Public } from './decorators.js';
import type { AuthUser } from './auth-user.js';
import { LoginResultDto, OtpChallengeDto, RefreshDto, RequestOtpDto, TokensDto, VerifyOtpDto } from './dto.js';
import { SessionsService } from './sessions.service.js';

@ApiTags('Authentification')
@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
  ) {}

  @Public()
  @Post('otp/request')
  @HttpCode(202)
  @ApiOperation({ summary: 'Envoie un code de connexion par SMS', description: 'Réponse identique que le numéro ait un compte ou non.' })
  @ApiResponse({ status: 202, type: OtpChallengeDto })
  @ApiResponse({ status: 429, description: 'Trop de demandes (RATE_LIMITED) ou renvoi trop rapproché (OTP_RESEND_TOO_SOON).' })
  requestCode(@Body() dto: RequestOtpDto, @Req() req: AppRequest): Promise<OtpChallengeDto> {
    return this.auth.requestLoginCode(dto.phone, clientIp(req));
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Vérifie le code et ouvre une session (crée le compte à la première connexion)' })
  @ApiResponse({ status: 200, type: LoginResultDto })
  verifyCode(@Body() dto: VerifyOtpDto, @Req() req: AppRequest): Promise<LoginResultDto> {
    return this.auth.loginWithCode(dto.challengeId, dto.code, dto.app, {
      ip: clientIp(req),
      userAgent: req.headers['user-agent'] ?? null,
      deviceLabel: dto.deviceLabel ?? null,
    });
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Échange le jeton de rafraîchissement contre une nouvelle paire de jetons (rotation)' })
  @ApiResponse({ status: 200, type: TokensDto })
  refresh(@Body() dto: RefreshDto, @Req() req: AppRequest): Promise<TokensDto> {
    return this.sessions.rotate(dto.refreshToken, { ip: clientIp(req), userAgent: req.headers['user-agent'] ?? null });
  }

  @Post('logout')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Déconnecte cet appareil' })
  async logout(@CurrentUser() user: AuthUser): Promise<void> {
    await this.sessions.revokeFamily(user.familyId, 'LOGOUT');
  }
}
