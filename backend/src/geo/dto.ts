import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsLatitude, IsLongitude, IsObject, IsOptional, IsString, IsUUID, Length, ValidateNested } from 'class-validator';

export class LatLngDto {
  @ApiProperty({ example: 5.36 }) @Type(() => Number) @IsLatitude() lat!: number;
  @ApiProperty({ example: -3.97 }) @Type(() => Number) @IsLongitude() lng!: number;
}

export class LocatedDto {
  @ApiProperty() inServiceArea!: boolean;
  @ApiPropertyOptional({ format: 'uuid' }) cityId?: string;
  @ApiPropertyOptional() cityName?: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) zoneId?: string | null;
  @ApiPropertyOptional({ nullable: true }) zoneName?: string | null;
  @ApiPropertyOptional({ description: 'Commune déduite du centre le plus proche (contours pas encore saisis)' }) zoneApproximate?: boolean;
}

export class PublicZoneDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['COMMUNE', 'QUARTIER', 'SECTEUR'] }) kind!: string;
  @ApiPropertyOptional({ type: LatLngDto, nullable: true }) centroid!: LatLngDto | null;
}

export class UpdateCityDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ type: LatLngDto }) @IsOptional() @ValidateNested() @Type(() => LatLngDto) center?: LatLngDto;
}

export class CreateZoneDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() cityId!: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() parentId?: string;
  @ApiProperty({ enum: ['COMMUNE', 'QUARTIER', 'SECTEUR'] }) @IsIn(['COMMUNE', 'QUARTIER', 'SECTEUR']) kind!: 'COMMUNE' | 'QUARTIER' | 'SECTEUR';
  @ApiProperty({ example: 'Riviera 2' }) @IsString() @Length(2, 80) name!: string;
  @ApiPropertyOptional({ type: LatLngDto }) @IsOptional() @ValidateNested() @Type(() => LatLngDto) centroid?: LatLngDto;
}

export class UpdateZoneDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 80) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ type: LatLngDto }) @IsOptional() @ValidateNested() @Type(() => LatLngDto) centroid?: LatLngDto;
  @ApiPropertyOptional({ description: 'Contour GeoJSON (Polygon ou MultiPolygon, WGS 84). null pour l’effacer.', nullable: true })
  @IsOptional() @IsObject() boundary?: Record<string, unknown> | null;
}
