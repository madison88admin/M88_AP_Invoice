/**
 * Migrate users from data/users.json to the database (APInvoice_User table).
 * Run with: npx ts-node scripts/migrate-users-to-db.ts
 */
import prisma from '../config/database';
import fs from 'fs';
import path from 'path';
import { hashPassword } from '../services/passwordService';

async function main() {
  console.log('Migrating users to database...');

  // Try to read existing users.json
  const usersFile = path.join(process.cwd(), 'data', 'users.json');
  let jsonUsers: any[] = [];

  if (fs.existsSync(usersFile)) {
    try {
      jsonUsers = JSON.parse(fs.readFileSync(usersFile, 'utf-8'));
      console.log(`Found ${jsonUsers.length} users in users.json`);
    } catch {
      throw new Error('Failed to parse data/users.json');
    }
  }

  if (jsonUsers.length === 0) {
    throw new Error('No users supplied. Create a protected data/users.json file; no default credentials are seeded.');
  }

  const usersToMigrate = jsonUsers.map((u: any) => {
    if (!u.name || !u.email || !u.role || (!u.password && !u.passwordHash)) {
      throw new Error(`Invalid user migration record for ${u.email || 'unknown user'}`);
    }
    return {
      name: u.name,
      email: u.email,
      role: u.role,
      password_hash: u.passwordHash || hashPassword(u.password),
    };
  });

  let created = 0;
  let skipped = 0;

  for (const u of usersToMigrate) {
    const existing = await prisma.user.findFirst({
      where: { email: { equals: u.email, mode: 'insensitive' } },
    });

    if (existing) {
      // Update existing user's password hash if needed
      if (existing.password_hash !== u.password_hash) {
        await prisma.user.update({
          where: { id: existing.id },
          data: { password_hash: u.password_hash },
        });
        console.log(`  Updated password for: ${u.email}`);
      } else {
        skipped++;
      }
    } else {
      await prisma.user.create({
        data: {
          name: u.name,
          email: u.email.toLowerCase(),
          role: u.role,
          password_hash: u.password_hash,
          active: true,
        },
      });
      created++;
      console.log(`  Created: ${u.email} (${u.role})`);
    }
  }

  console.log(`\nDone! Created: ${created}, Skipped/Updated: ${skipped}`);
  const total = await prisma.user.count();
  console.log(`Total users in database: ${total}`);
}

main()
  .catch((e) => {
    console.error('Migration failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
