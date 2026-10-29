import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || undefined : value);

export class AdminRefundDto {
  @ApiProperty({ description: 'Montant à rembourser (F CFA)' }) @IsInt() @Min(1) @Max(1_000_000_000) amountXof!: number;
  @ApiProperty({ example: 'Litige résolu : intervention incomplète' }) @Transform(trim) @IsString() @Length(5, 500) reason!: string;
}

export class CompleteRefundDto {
  @ApiProperty({ description: 'Référence du remboursement dans l’espace marchand du prestataire' }) @Transform(trim) @IsString() @Length(3, 120) providerRefundId!: string;
}

export class AdminPaymentsQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() missionId?: string;
  @ApiPropertyOptional({ enum: ['INITIATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'] })
  @IsOptional() @IsIn(['INITIATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED']) status?: 'INITIATED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
}

export class SandboxDecisionDto {
  @IsIn(['SUCCEEDED', 'FAILED', 'CANCELLED']) outcome!: 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  @IsOptional() @IsIn(['ORANGE_MONEY', 'MTN_MOMO', 'MOOV_MONEY', 'WAVE', 'CARD']) method?: string;
}
