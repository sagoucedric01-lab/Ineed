import { createHash, createPrivateKey, createPublicKey, type KeyObject, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { errors, jwtVerify, SignJWT } from 'jose';
import { ENV, type Env } from '../config/env.js';
import { AppError } from '../common/http/api-error.js';
import type { AppKind } from './auth-user.js';

export interface AccessClaims {
  sub: string;
  fid: string;
  app: AppKind;
}

/** Jetons d'accès JWT signés en ES256 (courte durée). Les jetons de rafraîchissement sont opaques (SessionsService). */
@Injectable()
export class TokensService {
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  readonly keyId: string;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.privateKey = createPrivateKey({ key: Buffer.from(env.JWT_PRIVATE_KEY_B64, 'base64'), format: 'der', type: 'pkcs8' });
    if (this.privateKey.asymmetricKeyType !== 'ec') throw new Error('JWT_PRIVATE_KEY_B64 doit être une clé ECDSA P-256');
    this.publicKey = createPublicKey(this.privateKey);
    this.keyId = createHash('sha256').update(this.publicKey.export({ format: 'der', type: 'spki' })).digest('hex').slice(0, 16);
  }

  async signAccess(claims: AccessClaims): Promise<{ token: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + this.env.ACCESS_TOKEN_TTL_S * 1000);
    const token = await new SignJWT({ fid: claims.fid, app: claims.app })
      .setProtectedHeader({ alg: 'ES256', kid: this.keyId, typ: 'JWT' })
      .setSubject(claims.sub)
      .setIssuer(this.env.JWT_ISSUER)
      .setAudience(`ineed:${claims.app}`)
      .setIssuedAt()
      .setJti(randomUUID())
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.privateKey);
    return { token, expiresAt };
  }

  /** Ticket court (5 min) entre l'étape mot de passe et l'étape TOTP de la connexion administrateur. */
  async signMfaTicket(userId: string): Promise<string> {
    return new SignJWT({ purpose: 'mfa' })
      .setProtectedHeader({ alg: 'ES256', kid: this.keyId, typ: 'JWT' })
      .setSubject(userId)
      .setIssuer(this.env.JWT_ISSUER)
      .setAudience('ineed:admin-mfa')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(this.privateKey);
  }

  async verifyMfaTicket(token: string): Promise<string> {
    try {
      const { payload } = await jwtVerify(token, this.publicKey, { issuer: this.env.JWT_ISSUER, audience: 'ineed:admin-mfa', algorithms: ['ES256'] });
      if (payload.purpose !== 'mfa' || typeof payload.sub !== 'string') throw new Error('ticket invalide');
      return payload.sub;
    } catch {
      throw new AppError(401, 'MFA_TICKET_INVALID', 'La connexion a expiré. Saisissez de nouveau votre mot de passe.');
    }
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    try {
      const { payload } = await jwtVerify(token, this.publicKey, { issuer: this.env.JWT_ISSUER, algorithms: ['ES256'] });
      const app = payload.app;
      if (typeof payload.sub !== 'string' || typeof payload.fid !== 'string' || (app !== 'CLIENT' && app !== 'PRO' && app !== 'ADMIN')) {
        throw new Error('revendications manquantes');
      }
      if (payload.aud !== `ineed:${app}`) throw new Error('audience incohérente');
      return { sub: payload.sub, fid: payload.fid, app };
    } catch (e) {
      const expired = e instanceof errors.JWTExpired;
      throw new AppError(401, expired ? 'TOKEN_EXPIRED' : 'UNAUTHENTICATED', 'Votre session a expiré. Reconnectez-vous pour continuer.');
    }
  }
}
