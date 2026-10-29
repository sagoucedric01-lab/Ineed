import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min, ValidateNested } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || undefined : value);

export class QuoteLineDto {
  @ApiProperty({ enum: ['TRAVEL', 'LABOR', 'MATERIAL', 'OTHER'], description: 'Déplacement, main-d’œuvre, pièces et matériaux, autre' })
  @IsIn(['TRAVEL', 'LABOR', 'MATERIAL', 'OTHER']) kind!: 'TRAVEL' | 'LABOR' | 'MATERIAL' | 'OTHER';
  @ApiProperty({ example: 'Remplacement du siphon' }) @Transform(trim) @IsString() @Length(2, 120) label!: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(1) @Max(1000) quantity?: number;
  @ApiProperty({ description: 'Prix unitaire en F CFA (entier)' }) @IsInt() @Min(0) @Max(10_000_000) unitPriceXof!: number;
  @ApiPropertyOptional({ description: 'Justification (obligatoire pour des frais supplémentaires)' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(500) justification?: string;
}

export class SubmitQuoteDto {
  @ApiProperty({ type: [QuoteLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => QuoteLineDto) lines!: QuoteLineDto[];
  @ApiPropertyOptional({ description: 'Durée de validité en heures (48 h par défaut)' }) @IsOptional() @IsInt() @Min(1) @Max(720) validForHours?: number;
  @ApiPropertyOptional({ description: 'Conditions : garantie, délai, ce qui n’est pas compris' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) conditions?: string;
  @ApiPropertyOptional({ description: 'Durée estimée des travaux (minutes)' }) @IsOptional() @IsInt() @Min(5) @Max(10_080) estimatedDurationMin?: number;
}

export class RejectQuoteDto {
  @ApiPropertyOptional({ example: 'Trop cher, je voudrais une autre proposition' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(500) reason?: string;
}
