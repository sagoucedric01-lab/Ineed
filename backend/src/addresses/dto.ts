import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { LatLngDto } from '../geo/dto.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || undefined : value);

export class AddressInputDto {
  @ApiProperty({ type: LatLngDto, description: 'Point choisi ou déplacé sur la carte' }) @ValidateNested() @Type(() => LatLngDto) location!: LatLngDto;
  @ApiPropertyOptional({ format: 'uuid', description: 'Commune choisie par le client (sinon déduite du point)' }) @IsOptional() @IsUUID() zoneId?: string;
  @ApiPropertyOptional({ example: 'Maison' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(40) label?: string;
  @ApiPropertyOptional({ example: 'Rue des Jardins, villa 12', description: 'Facultatif : beaucoup d’adresses n’ont pas de numéro' })
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) street?: string;
  @ApiPropertyOptional({ example: 'Derrière la pharmacie des Deux-Plateaux, portail bleu' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(200) landmark?: string;
  @ApiPropertyOptional({ example: 'Appeler en arrivant, 2e étage' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(300) instructions?: string;
}

export class AddressDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiPropertyOptional({ nullable: true }) label!: string | null;
  @ApiProperty({ type: LatLngDto }) location!: LatLngDto;
  @ApiProperty({ format: 'uuid' }) cityId!: string;
  @ApiProperty() cityName!: string;
  @ApiPropertyOptional({ nullable: true }) zoneId!: string | null;
  @ApiPropertyOptional({ nullable: true }) zoneName!: string | null;
  @ApiPropertyOptional({ nullable: true }) street!: string | null;
  @ApiPropertyOptional({ nullable: true }) landmark!: string | null;
  @ApiPropertyOptional({ nullable: true }) instructions!: string | null;
}
