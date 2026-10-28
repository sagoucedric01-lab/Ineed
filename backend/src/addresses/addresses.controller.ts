import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user.js';
import { Access, CurrentUser } from '../auth/decorators.js';
import { AddressesService } from './addresses.service.js';
import { AddressDto, AddressInputDto } from './dto.js';

@ApiTags('Mon compte')
@ApiBearerAuth()
@Access({ app: 'CLIENT' })
@Controller('v1/me/addresses')
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Get()
  @ApiResponse({ status: 200, type: [AddressDto] })
  list(@CurrentUser() user: AuthUser) {
    return this.addresses.list(user.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Enregistre une adresse (point sur la carte, commune, repère)' })
  @ApiResponse({ status: 201, type: AddressDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: AddressInputDto) {
    return this.addresses.create(user.userId, dto);
  }

  @Put(':id')
  @ApiResponse({ status: 200, type: AddressDto })
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddressInputDto) {
    return this.addresses.update(user.userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.addresses.remove(user.userId, id);
  }
}
