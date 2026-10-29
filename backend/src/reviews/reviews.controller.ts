import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user.js';
import { Access, CurrentUser } from '../auth/decorators.js';
import { CreateReviewDto, PageQueryDto, ReplyReviewDto } from './dto.js';
import { ReviewsService } from './reviews.service.js';

@ApiTags('Avis')
@ApiBearerAuth()
@Access({ app: 'CLIENT' })
@Controller('v1/missions/:missionId/review')
export class ClientReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  @ApiOperation({ summary: 'Mon avis sur la mission, et si je peux encore en donner un' })
  get(@CurrentUser() user: AuthUser, @Param('missionId', ParseUUIDPipe) missionId: string) {
    return this.reviews.forMission(user.userId, missionId);
  }

  @Post()
  @ApiOperation({ summary: 'Noter le professionnel (mission clôturée seulement, une fois)' })
  create(@CurrentUser() user: AuthUser, @Param('missionId', ParseUUIDPipe) missionId: string, @Body() dto: CreateReviewDto) {
    return this.reviews.create(user.userId, missionId, dto.rating, dto.comment);
  }
}

@ApiTags('Avis')
@ApiBearerAuth()
@Access({ app: 'CLIENT' })
@Controller('v1/pros/:proId/reviews')
export class PublicReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  @ApiOperation({ summary: 'Avis publiés sur un professionnel' })
  list(@Param('proId', ParseUUIDPipe) proId: string, @Query() q: PageQueryDto) {
    return this.reviews.publicList(proId, q.page);
  }
}

@ApiTags('Professionnel — avis')
@ApiBearerAuth()
@Access({ app: 'PRO', roles: ['PRO'] })
@Controller('v1/pro/reviews')
export class ProReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: PageQueryDto) {
    return this.reviews.forPro(user.userId, q.page);
  }

  @Post(':id/reply')
  @ApiOperation({ summary: 'Répondre publiquement à un avis (une fois)' })
  reply(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReplyReviewDto) {
    return this.reviews.reply(user.userId, id, dto.reply);
  }
}
