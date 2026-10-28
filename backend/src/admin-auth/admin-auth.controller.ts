import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsJWT, IsString, Length, Matches } from 'class-validator';
import type { AuthUser } from '../auth/auth-user.js';
import { Access, CurrentUser, Public } from '../auth/decorators.js';
import { TokensDto } from '../auth/dto.js';
import { auditContext, clientIp, type AppRequest } from '../common/http/request-context.js';
import { AdminAuthService } from './admin-auth.service.js';

class AdminLoginDto {
  @ApiProperty({ example: 'exploitation@ineed.ci' }) @IsEmail() email!: string;
  @ApiProperty() @IsString() @Length(1, 200) password!: string;
}

class AdminTotpDto {
  @ApiProperty() @IsJWT() mfaToken!: string;
  @ApiProperty({ example: '123456' }) @Matches(/^\d{6}$/) code!: string;
}

class ChangePasswordDto {
  @ApiProperty() @IsString() @Length(1, 200) currentPassword!: string;
  @ApiProperty() @IsString() @Length(12, 200) newPassword!: string;
}

@ApiTags('Administration — connexion')
@Controller('v1/admin/auth')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Étape 1 : e-mail et mot de passe (retourne un ticket pour l’étape TOTP)' })
  login(@Body() dto: AdminLoginDto, @Req() req: AppRequest) {
    return this.auth.login(dto.email, dto.password, { ...auditContext(req), ip: clientIp(req) });
  }

  @Public()
  @Post('totp')
  @HttpCode(200)
  @ApiOperation({ summary: 'Étape 2 : code de l’application d’authentification ; ouvre la session' })
  totp(@Body() dto: AdminTotpDto, @Req() req: AppRequest): Promise<TokensDto> {
    return this.auth.verifyTotp(dto.mfaToken, dto.code, { ...auditContext(req), ip: clientIp(req) });
  }

  @Post('password')
  @HttpCode(204)
  @ApiBearerAuth()
  @Access({ app: 'ADMIN' })
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto, @Req() req: AppRequest): Promise<void> {
    await this.auth.changePassword(user.userId, dto.currentPassword, dto.newPassword, auditContext(req));
  }
}
