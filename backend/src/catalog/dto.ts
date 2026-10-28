import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ICON_KEY = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PRICING = ['FIXED', 'QUOTE', 'TRAVEL_PLUS_DIAGNOSIS'] as const;
const XOF_LIMIT = 100_000_000;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class SkillDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
}

export class ServiceDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ nullable: true }) description!: string | null;
  @ApiProperty({ enum: PRICING, description: 'Prix fixe, sur devis, ou déplacement puis diagnostic' }) pricingModel!: string;
  @ApiPropertyOptional({ nullable: true, description: 'Fourchette indicative en F CFA (entiers)' }) referenceMinXof!: number | null;
  @ApiPropertyOptional({ nullable: true }) referenceMaxXof!: number | null;
  @ApiPropertyOptional({ nullable: true }) fixedPriceXof!: number | null;
}

export class CategoryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ nullable: true }) description!: string | null;
  @ApiProperty({ description: 'Clé de l’icône (design/icons/categories)' }) iconKey!: string;
  @ApiProperty({ type: [SkillDto] }) skills!: SkillDto[];
  @ApiProperty({ type: [ServiceDto], description: 'Prestations (sous-catégories) proposées aux clients' }) services!: ServiceDto[];
}

export class CatalogSearchQueryDto {
  @ApiProperty({ example: 'fuite', description: 'Métier, prestation ou description du problème' })
  @Transform(trim) @IsString() @Length(2, 80) q!: string;
}

export class CreateCategoryDto {
  @ApiProperty({ example: 'jardinage' }) @IsString() @Matches(SLUG, { message: 'Identifiant : lettres minuscules, chiffres et tirets.' }) @Length(2, 60) slug!: string;
  @ApiProperty({ example: 'Jardinage' }) @Transform(trim) @IsString() @Length(2, 60) name!: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional({ type: [String], description: 'Synonymes et mots utilisés par les clients' })
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @Length(2, 60, { each: true }) searchTerms?: string[];
  @ApiProperty({ example: 'autres' }) @IsString() @Matches(ICON_KEY) @Length(2, 40) iconKey!: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
}

export class UpdateCategoryDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(2, 60) name?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(trim) @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @Length(2, 60, { each: true }) searchTerms?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(ICON_KEY) @Length(2, 40) iconKey?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
  @ApiPropertyOptional({ description: 'false : le métier disparaît immédiatement des applications' }) @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateServiceDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() categoryId!: string;
  @ApiProperty({ example: 'plomberie-robinet' }) @IsString() @Matches(SLUG) @Length(2, 80) slug!: string;
  @ApiProperty({ example: 'Remplacement de robinet' }) @Transform(trim) @IsString() @Length(2, 80) name!: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(500) description?: string;
  @ApiProperty({ enum: PRICING }) @IsIn(PRICING) pricingModel!: (typeof PRICING)[number];
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(XOF_LIMIT) referenceMinXof?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(XOF_LIMIT) referenceMaxXof?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(XOF_LIMIT) fixedPriceXof?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(XOF_LIMIT) defaultTravelFeeXof?: number;
}

export class UpdateServiceDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(2, 80) name?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional({ enum: PRICING }) @IsOptional() @IsIn(PRICING) pricingModel?: (typeof PRICING)[number];
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() @Min(0) @Max(XOF_LIMIT) referenceMinXof?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() @Min(0) @Max(XOF_LIMIT) referenceMaxXof?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() @Min(1) @Max(XOF_LIMIT) fixedPriceXof?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() @Min(0) @Max(XOF_LIMIT) defaultTravelFeeXof?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateSkillDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() categoryId!: string;
  @ApiProperty({ example: 'Pose de chauffe-eau' }) @Transform(trim) @IsString() @Length(2, 60) name!: string;
}

export class UpdateSkillDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 60) name!: string;
}
