import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsLatitude, IsLongitude, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class SearchProsQueryDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() categoryId!: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() serviceId?: string;
  @ApiProperty({ enum: ['URGENT', 'SCHEDULED'] }) @IsIn(['URGENT', 'SCHEDULED']) mode!: 'URGENT' | 'SCHEDULED';
  @ApiProperty({ example: 5.36 }) @Type(() => Number) @IsLatitude() lat!: number;
  @ApiProperty({ example: -3.97 }) @Type(() => Number) @IsLongitude() lng!: number;
  @ApiPropertyOptional({ format: 'uuid', description: 'Commune choisie par le client' }) @IsOptional() @IsUUID() zoneId?: string;
  @ApiPropertyOptional({ description: 'Rayon (m), borné par la règle d’attribution ; rayon initial par défaut' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(500) @Max(100_000) radiusM?: number;
  @ApiPropertyOptional({ format: 'date-time', description: 'Début du créneau (mode programmé)' }) @IsOptional() @IsDateString() start?: string;
  @ApiPropertyOptional({ format: 'date-time', description: 'Fin du créneau (mode programmé)' }) @IsOptional() @IsDateString() end?: string;
}
