import { Body, Controller, Delete, HttpCode, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/decorators.js';
import { PrismaService } from '../infra/prisma.service.js';
import { RegisterDeviceDto } from './dto.js';

@ApiTags('Mon compte')
@ApiBearerAuth()
@Controller('v1/me/devices')
export class DevicesController {
  constructor(private readonly prisma: PrismaService) {}

  @Put()
  @HttpCode(204)
  @ApiOperation({ summary: 'Enregistre l’appareil pour les notifications push (un jeton passé à un autre compte lui est retiré)' })
  async register(@CurrentUser() user: AuthUser, @Body() dto: RegisterDeviceDto) {
    const now = new Date();
    await this.prisma.device.upsert({
      where: { pushToken: dto.pushToken },
      create: { userId: user.userId, app: user.app, platform: dto.platform, pushToken: dto.pushToken, appVersion: dto.appVersion ?? null, lastSeenAt: now },
      update: { userId: user.userId, app: user.app, platform: dto.platform, appVersion: dto.appVersion ?? null, lastSeenAt: now, disabledAt: null },
    });
  }

  @Delete(':pushToken')
  @HttpCode(204)
  @ApiOperation({ summary: 'Retire l’appareil (déconnexion) : plus aucune notification push n’y est envoyée' })
  async remove(@CurrentUser() user: AuthUser, @Param('pushToken') pushToken: string) {
    await this.prisma.device.updateMany({ where: { pushToken, userId: user.userId }, data: { disabledAt: new Date() } });
  }
}
