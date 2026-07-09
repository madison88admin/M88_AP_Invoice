import { PrismaClient } from '@prisma/client';

const DB_ENABLED = process.env.DATABASE_URL && process.env.DATABASE_URL.length > 0;

let realPrisma: PrismaClient | null = null;

if (DB_ENABLED) {
  realPrisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });
  console.log('[Database] DB_ENABLED mode - Prisma initialized');
} else {
  console.log('[Database] DB_DISABLED mode - Prisma not initialized (vendor system offline)');
}

// Proxy that exposes a non-null PrismaClient type but throws if DB is disabled
const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    if (!realPrisma) {
      throw new Error('Database not available');
    }
    return (realPrisma as any)[prop];
  },
});

export default prisma;

export const getPrisma = () => realPrisma;

export const isDbEnabled = () => DB_ENABLED;

export const isDbConnected = async () => {
  if (!DB_ENABLED || !realPrisma) return false;
  try {
    await realPrisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
};

export const connectDatabase = async () => {
  if (!DB_ENABLED || !realPrisma) {
    console.log('[Database] DB disabled - skipping connection');
    return;
  }

  try {
    await prisma.$connect();
    console.log('Database connected successfully');
  } catch (error) {
    console.error('Database connection error:', error);
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    } else {
      console.warn('Running without database — some endpoints will not work');
    }
  }
};

export const disconnectDatabase = async () => {
  if (realPrisma) {
    await realPrisma.$disconnect();
  }
};
