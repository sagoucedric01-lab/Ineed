import { Body, Controller, Get, HttpCode, Patch, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user.js';
import { Access, CurrentUser } from '../auth/decorators.js';
import { AppError } from '../common/http/api-error.js';
import { auditContext, type AppRequest } from '../common/http/request-context.js';
import { PrismaService } from '../infra/prisma.service.js';
import { AddDocumentDto, AvailabilityDto, SaveProProfileDto } from './dto.js';
import { ProsService } from './pros.service.js';

/** Dossier du professionnel connecté (application Ineed Pro uniquement). */
@ApiTags('Professionnel')
@ApiBearerAuth()
@Access({ app: 'PRO', roles: ['PRO'] })
@Controller('v1/pro')
export class ProController {
  constructor(
    private readonly pros: ProsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('profile')
  @ApiOperation({ summary: 'Mon dossier professionnel (statut, éléments manquants)' })
  async profile(@CurrentUser() user: AuthUser) {
    const view = await this.pros.view(user.userId);
    if (!view) throw new AppError(404, 'PROFILE_NOT_STARTED', 'Votre dossier professionnel n’est pas encore commencé.');
    return view;
  }

  @Put('profile')
  @ApiOperation({ summary: 'Crée ou met à jour le brouillon du dossier' })
  save(@CurrentUser() user: AuthUser, @Body() dto: SaveProProfileDto) {
    return this.pros.saveDraft(user.userId, dto);
  }

  @Get('document-types')
  @ApiOperation({ summary: 'Justificatifs acceptés, avec ceux obligatoires selon le type de compte' })
  async documentTypes() {
    const types = await this.prisma.verificationDocumentType.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } });
    return types.map((t) => ({ code: t.code, label: t.label, requiredFor: t.requiredFor }));
  }

  @Post('documents')
  @ApiOperation({ summary: 'Ajoute un justificatif (fichier VERIFICATION_DOC finalisé, stockage privé)' })
  addDocument(@CurrentUser() user: AuthUser, @Body() dto: AddDocumentDto) {
    return this.pros.addDocument(user.userId, dto.typeCode, dto.fileId);
  }

  @Post('profile/submit')
  @HttpCode(200)
  @ApiOperation({ summary: 'Envoie le dossier à la vérification' })
  submit(@CurrentUser() user: AuthUser, @Req() req: AppRequest) {
    return this.pros.submit(user.userId, auditContext(req));
  }

  @Patch('availability')
  @ApiOperation({ summary: 'Disponible maintenant / pause (professionnels validés)' })
  availability(@CurrentUser() user: AuthUser, @Body() dto: AvailabilityDto) {
    const paused = dto.pausedUntil === undefined ? undefined : dto.pausedUntil === null ? null : new Date(dto.pausedUntil);
    return this.pros.setAvailability(user.userId, dto.isOnline, paused);
  }
}
