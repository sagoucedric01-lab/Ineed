import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Access } from '../auth/decorators.js';
import { SearchProsQueryDto } from './dto.js';
import { ProSearchService } from './pro-search.service.js';
import { PublicProfilesService } from './public-profiles.service.js';

@ApiTags('Recherche')
@ApiBearerAuth()
@Access({ app: 'CLIENT' })
@Controller('v1/pros')
export class SearchController {
  constructor(
    private readonly search: ProSearchService,
    private readonly profiles: PublicProfilesService,
  ) {}

  @Get('search')
  @ApiOperation({
    summary: 'Professionnels validés proches et disponibles pour un métier',
    description: 'Classement : distance, note vérifiée, taux d’acceptation, annulations. Sans résultat, des pistes sont proposées (élargir le rayon, programmer, changer de créneau).',
  })
  find(@Query() q: SearchProsQueryDto) {
    return this.search.search({
      categoryId: q.categoryId,
      serviceId: q.serviceId,
      mode: q.mode,
      location: { lat: q.lat, lng: q.lng },
      zoneId: q.zoneId,
      radiusM: q.radiusM,
      window: q.start && q.end ? { start: new Date(q.start), end: new Date(q.end) } : undefined,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Profil public d’un professionnel validé' })
  profile(@Param('id', ParseUUIDPipe) id: string) {
    return this.profiles.get(id);
  }
}
