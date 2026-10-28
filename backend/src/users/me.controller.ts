import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/decorators.js';
import { OtpChallengeDto } from '../auth/dto.js';
import { SessionsService } from '../auth/sessions.service.js';
import { AppError } from '../common/http/api-error.js';
import { auditContext, clientIp, type AppRequest } from '../common/http/request-context.js';
import { ConfirmDeletionDto, MeDto, SessionDto, SetAvatarDto, UpdateMeDto } from './dto.js';
import { UsersService } from './users.service.js';

@ApiTags('Mon compte')
@ApiBearerAuth()
@Controller('v1/me')
export class MeController {
  constructor(
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
  ) {}

  @Get()
  @ApiResponse({ status: 200, type: MeDto })
  me(@CurrentUser() user: AuthUser): Promise<MeDto> {
    return this.users.me(user.userId);
  }

  @Patch()
  @ApiOperation({ summary: 'Renseigne ou modifie le prénom et le nom' })
  @ApiResponse({ status: 200, type: MeDto })
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto): Promise<MeDto> {
    return this.users.updateNames(user.userId, dto.firstName, dto.lastName);
  }

  @Put('avatar')
  @ApiOperation({ summary: 'Définit la photo de profil (fichier AVATAR finalisé)' })
  @ApiResponse({ status: 200, type: MeDto })
  avatar(@CurrentUser() user: AuthUser, @Body() dto: SetAvatarDto): Promise<MeDto> {
    return this.users.setAvatar(user.userId, dto.fileId);
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Appareils connectés' })
  @ApiResponse({ status: 200, type: [SessionDto] })
  async listSessions(@CurrentUser() user: AuthUser): Promise<SessionDto[]> {
    const rows = await this.sessions.listActive(user.userId);
    return rows.map((s) => ({
      id: s.familyId,
      app: s.app,
      deviceLabel: s.deviceLabel,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      current: s.familyId === user.familyId,
    }));
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Déconnecte un appareil' })
  async revokeSession(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    const mine = (await this.sessions.listActive(user.userId)).some((s) => s.familyId === id);
    if (!mine) throw new AppError(404, 'NOT_FOUND', 'Cet élément n’existe plus ou a été supprimé.');
    await this.sessions.revokeFamily(id, 'REVOKED_BY_USER');
  }

  @Post('deletion/code')
  @HttpCode(202)
  @ApiOperation({ summary: 'Envoie un code SMS pour confirmer la suppression du compte' })
  @ApiResponse({ status: 202, type: OtpChallengeDto })
  requestDeletion(@CurrentUser() user: AuthUser, @Req() req: AppRequest): Promise<OtpChallengeDto> {
    return this.users.requestDeletionCode(user.userId, clientIp(req));
  }

  @Post('deletion')
  @HttpCode(204)
  @ApiOperation({ summary: 'Supprime le compte (anonymisation) après vérification du code SMS' })
  async confirmDeletion(@CurrentUser() user: AuthUser, @Body() dto: ConfirmDeletionDto, @Req() req: AppRequest): Promise<void> {
    await this.users.confirmDeletion(user.userId, dto.challengeId, dto.code, { ...auditContext(req), ip: clientIp(req) });
  }
}
