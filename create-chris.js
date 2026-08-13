process.env.DATABASE_URL = 'postgresql://supabase_admin.m88:Madison_88_admin**@5.223.78.194:5432/postgres?schema=AP_Invoice';
const { PrismaClient } = require('C:/Users/JC/OneDrive - Madison88/AP Invoice/apps/api/node_modules/@prisma/client');
const crypto = require('crypto');
const prisma = new PrismaClient();

(async () => {
  // Check if chris@madison88.com already exists
  const existing = await prisma.$queryRawUnsafe(`
    SELECT id, name, email, role FROM "AP_Invoice"."APInvoice_User" 
    WHERE email = 'chris@madison88.com'
  `);
  if (existing.length > 0) {
    console.log('Account already exists:', JSON.stringify(existing[0], null, 2));
    await prisma.$disconnect();
    return;
  }

  // Generate a random password
  const generatePassword = () => {
    const length = 12;
    const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
    let password = '';
    for (let i = 0; i < length; i++) {
      password += charset[crypto.randomInt(0, charset.length)];
    }
    return password;
  };

  const password = generatePassword();
  const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');

  // Create the user
  const userId = crypto.randomUUID();
  const now = new Date();
  
  await prisma.$executeRawUnsafe(`
    INSERT INTO "AP_Invoice"."APInvoice_User" (id, name, email, password_hash, role, active, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `, userId, 'Chris', 'chris@madison88.com', hashedPassword, 'MS_POLLY', true, now, now);

  console.log('✅ Account created successfully!');
  console.log('   Name:     Chris');
  console.log('   Email:    chris@madison88.com');
  console.log('   Role:     MS_POLLY');
  console.log('   Password: ' + password);
  console.log('   Active:   true');
  console.log('');
  console.log('⚠️  Save this password — it cannot be recovered later.');

  await prisma.$disconnect();
})();
