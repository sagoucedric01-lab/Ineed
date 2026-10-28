import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/decorators.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../infra/prisma.service.js';

/** Les notifications de l'espace professionnel (« pro.* ») ne s'affichent que dans Ineed Pro, et inversement. */
function forApp(user: AuthUser): Prisma.NotificationWhereInput {
  return user.app === 'PRO' ? { type: { startsWith: 'pro.' } } : { NOT: { type: { startsWith: 'pro.' } } };
}

@ApiTags('Mon compte')
@ApiBearerAuth()
@Controller('v1/me/notifications')
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Mes notifications (les 50 plus récentes) et le nombre de non lues' })
  async list(@CurrentUser() user: AuthUser) {
    const where = { userId: user.userId, ...forApp(user) };
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.notification.count({ where: { ...where, readAt: null } }),
    ]);
    return {
      unread,
      items: items.map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, data: n.data, read: n.readAt !== null, createdAt: n.createdAt.toISOString() })),
    };
  }

  @Post('read')
  @HttpCode(204)
  @ApiOperation({ summary: 'Marque toutes mes notifications comme lues' })
  async markRead(@CurrentUser() user: AuthUser) {
    await this.prisma.notification.updateMany({ where: { userId: user.userId, readAt: null, ...forApp(user) }, data: { readAt: new Date() } });
  }
}
