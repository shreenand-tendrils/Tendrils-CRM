import 'dotenv/config';

const required = ['DATABASE_URL', 'AUTH_SECRET', 'AUTH_GOOGLE_ID', 'AUTH_GOOGLE_SECRET'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  const msg = `Missing environment variables: ${missing.join(', ')} (see .env.example)`;
  if (process.env.NODE_ENV === 'production') throw new Error(msg);
  console.warn(`[env] ${msg}`);
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  webOrigins: (process.env.WEB_ORIGIN || 'http://localhost:5173').split(',').map((v) => v.trim()),
  uploadDir: process.env.UPLOAD_DIR || './uploads',
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 15) * 1024 * 1024,
};
