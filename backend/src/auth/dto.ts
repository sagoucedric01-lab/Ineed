import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';

export class RequestOtpDto {
  @ApiProperty({ example: '07 12 34 56 78', description: 'Numéro saisi par l’utilisateur ; le préfixe +225 est ajouté si absent.' })
  @IsString()
  @Length(6, 24)
  phone!: string;
}

export class OtpChallengeDto {
  @ApiProperty({ format: 'uuid' }) challengeId!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @ApiProperty({ format: 'date-time' }) resendAvailableAt!: string;
  @ApiProperty({ description: 'Vrai si aucun SMS n’est réellement envoyé (mode développement).' }) devMode!: boolean;
}

export class VerifyOtpDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  challengeId!: string;

  @ApiProperty({ example: '481920' })
  @Matches(/^\d{6}$/)
  code!: string;

  @ApiProperty({ enum: ['CLIENT', 'PRO'] })
  @IsIn(['CLIENT', 'PRO'])
  app!: 'CLIENT' | 'PRO';

  @ApiPropertyOptional({ example: 'Samsung Galaxy A15' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceLabel?: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @Length(20, 200)
  refreshToken!: string;
}

export class TokensDto {
  @ApiProperty({ example: 'Bearer' }) tokenType!: 'Bearer';
  @ApiProperty() accessToken!: string;
  @ApiProperty({ format: 'date-time' }) accessTokenExpiresAt!: string;
  @ApiProperty() refreshToken!: string;
  @ApiProperty({ format: 'date-time' }) refreshTokenExpiresAt!: string;
}

export class LoginUserDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: '+2250712345678' }) phone!: string;
  @ApiProperty({ nullable: true, type: String }) firstName!: string | null;
  @ApiProperty({ nullable: true, type: String }) lastName!: string | null;
  @ApiProperty({ type: [String] }) roles!: string[];
}

export class LoginResultDto {
  @ApiProperty({ type: TokensDto }) tokens!: TokensDto;
  @ApiProperty({ type: LoginUserDto }) user!: LoginUserDto;
  @ApiProperty() isNewUser!: boolean;
  @ApiProperty({ description: 'Faux tant que prénom et nom ne sont pas renseignés.' }) profileComplete!: boolean;
}
