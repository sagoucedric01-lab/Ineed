// Crée le PREMIER compte administrateur (rôle ADMIN_SUPER). Aucun compte ni mot de passe n'est écrit dans le code :
// le mot de passe est tiré au hasard, affiché une seule fois, et la double authentification (TOTP) est imposée
// à la première connexion. Refuse d'agir si un super-administrateur existe déjà.
// Usage : node dist/cli/admin-bootstrap.js --email exploitation@ineed.ci --first-name Aminata --last-name Diallo
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import { hashPassword } from '../admin-auth/passwords.js';
import { loadEnv } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';

const { values } = parseArgs({
  options: { email: { type: 'string' }, 'first-name': { type: 'string' }, 'last-name': { type: 'string' } },
});
const email = values.email?.trim().toLowerCase();
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !values['first-name'] || !values['last-name']) {
  console.error('Usage : admin-bootstrap --email <adresse> --first-name <prénom> --last-name <nom>');
  process.exit(2);
}

const env = loadEnv();
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
try {
  const existing = await prisma.userRole.count({ where: { role: { code: 'ADMIN_SUPER' } } });
  if (existing > 0) {
    console.error('Un super-administrateur existe déjà. Les autres comptes se créent depuis l’administration.');
    process.exitCode = 1;
  } else {
    const password = randomBytes(18).toString('base64url');
    const passwordHash = await hashPassword(password);
    await prisma.$transaction(async (tx) => {
      const role = await tx.role.findUniqueOrThrow({ where: { code: 'ADMIN_SUPER' } });
      const user = await tx.user.create({ data: { email, firstName: values['first-name']!, lastName: values['last-name']! } });
      await tx.userRole.create({ data: { userId: user.id, roleId: role.id } });
      await tx.adminCredential.create({ data: { userId: user.id, passwordHash } });
      await tx.auditLog.create({ data: { actorId: null, action: 'admin.bootstrap', entityType: 'user', entityId: user.id, after: { email } } });
    });
    console.log(`Super-administrateur créé : ${email}`);
    console.log(`Mot de passe provisoire (affiché une seule fois, à changer après la première connexion) : ${password}`);
    console.log('À la première connexion, l’administration demandera d’enregistrer la double authentification.');
  }
} finally {
  await prisma.$disconnect();
}
