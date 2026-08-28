import mysql from 'mysql2/promise';

function getRequiredEnv(name: string): string {
  const value = process.env[name];

  if (value === undefined) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

const databasePort = Number(getRequiredEnv('DB_PORT'));

if (!Number.isInteger(databasePort)) {
  throw new Error('DB_PORT must be an integer');
}

export const databasePool = mysql.createPool({
  host: getRequiredEnv('DB_HOST'),
  port: databasePort,
  user: getRequiredEnv('DB_USER'),
  password: getRequiredEnv('DB_PASSWORD'),
  database: getRequiredEnv('DB_NAME'),
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});