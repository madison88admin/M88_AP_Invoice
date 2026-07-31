/**
 * Migrate users from data/users.json to the database (APInvoice_User table).
 * Run with: npx ts-node scripts/migrate-users-to-db.ts
 */
import prisma from '../config/database';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Default users to seed if users.json doesn't exist or is empty
const DEFAULT_USERS = [
  { name: 'Maryan', email: 'maryan.untiveros@madison88.com', role: 'MLO_ACCOUNT_HOLDER', password: 'madison88' },
  { name: 'Edwin', email: 'edwin.garcia@madison88.com', role: 'PLANNING_MANAGER', password: 'madison88' },
  { name: 'Glecie', email: 'glecie.yumena@madison88.com', role: 'PLANNING_MANAGER', password: 'madison88' },
  { name: 'Lindsey', email: 'lindsey.castro@madison88.com', role: 'SR_MANAGER_GLOBAL_PRODUCTION', password: 'madison88' },
  { name: 'Polly', email: 'polly.madison@madison88.com', role: 'MS_POLLY', password: 'madison88' },
  { name: 'JC', email: 'jc@madison88.com', role: 'SUPERADMIN', password: 'Ar5yG3#4' },
  { name: 'Meann', email: 'meann@madison88.com', role: 'PURCHASING_MANAGER', password: 'madison88' },
  { name: 'Maricar', email: 'maricar@madison88.com', role: 'PURCHASING_MANAGER', password: 'madison88' },
  { name: 'Maricon', email: 'maricon@madison88.com', role: 'PURCHASING_COORDINATOR', password: 'madison88' },
  { name: 'Pamela', email: 'pamela@madison88.com', role: 'PURCHASING_COORDINATOR', password: 'madison88' },
  { name: 'Sarah', email: 'sarah@madison88.com', role: 'PURCHASING_COORDINATOR', password: 'madison88' },
  { name: 'April', email: 'april@madison88.com', role: 'PURCHASING_COORDINATOR', password: 'madison88' },
  { name: 'Jasmine', email: 'jasmine@madison88.com', role: 'PURCHASING_COORDINATOR', password: 'madison88' },
  { name: 'Earl', email: 'earl@madison88.com', role: 'PURCHASING_COORDINATOR', password: 'madison88' },
  { name: 'MJ Santiago', email: 'mjsantiago@madison88.com', role: 'PURCHASING_COORDINATOR', password: 'madison88' },
  { name: 'Joy', email: 'joy@madison88.com', role: 'PURCHASING_COORDINATOR', password: 'madison88' },
  { name: 'Wyssa', email: 'wyssa@madison88.com', role: 'ACCOUNTING_ASSOCIATE', password: 'madison88' },
  { name: 'Aldrin', email: 'Aldrin@madison88.com', role: 'ACCOUNTING_SUPERVISOR', password: 'madison88' },
];

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
      console.log('Failed to parse users.json, using defaults');
    }
  }

  // If no JSON users, use defaults
  const usersToMigrate = jsonUsers.length > 0
    ? jsonUsers.map((u: any) => ({
        name: u.name,
        email: u.email,
        role: u.role,
        password_hash: u.passwordHash || hashPassword(u.password || 'madison88'),
      }))
    : DEFAULT_USERS.map(u => ({
        name: u.name,
        email: u.email,
        role: u.role,
        password_hash: hashPassword(u.password),
      }));

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
