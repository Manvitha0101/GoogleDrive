'use strict';

const { PrismaClient } = require('@prisma/client');

// Enable JSON serialization of BigInt fields (storageUsed, size, etc.)
BigInt.prototype.toJSON = function () {
  const intVal = Number(this);
  return Number.isSafeInteger(intVal) ? intVal : this.toString();
};

// Singleton Prisma client
const prisma = new PrismaClient({
  log:
    process.env.NODE_ENV === 'development'
      ? [{ emit: 'stdout', level: 'warn' }, { emit: 'stdout', level: 'error' }]
      : [{ emit: 'stdout', level: 'error' }],
});

module.exports = prisma;
