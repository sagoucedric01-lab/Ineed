import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { WindowDto } from '../requests/dto.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || undefined : value);

export class ProposalDto {
  @ApiProperty({ format: 'date-time', description: 'Heure d’arrivée proposée, dans le créneau du client' }) @IsDateString() proposedStartAt!: string;
  @ApiPropertyOptional({ description: 'Prix proposé (F CFA)' }) @IsOptional() @IsInt() @Min(500) @Max(10_000_000) proposedPriceXof?: number;
  @ApiPropertyOptional({ description: 'Frais de déplacement (F CFA)' }) @IsOptional() @IsInt() @Min(0) @Max(1_000_000) proposedTravelFeeXof?: number;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(500) message?: string;
}

export class DeclineOfferDto {
  @ApiPropertyOptional({ example: 'Je suis occupé' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(200) reason?: string;
}

export class RetryRequestDto {
  @ApiPropertyOptional({ type: WindowDto, description: 'Passer en demande programmée sur ce créneau' }) @IsOptional() @ValidateNested() @Type(() => WindowDto) window?: WindowDto;
}
