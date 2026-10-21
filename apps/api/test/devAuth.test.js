import test from 'node:test';
import assert from 'node:assert/strict';
import { signDevToken, verifyDevToken, isDemoEmail, devEmailFromCookieHeader, DEV_COOKIE, isDevLoginEnabled } from '../src/services/devAuth.js';

test('dev token: sign/verify, tamper-proof, demo emails only', () => {
  process.env.AUTH_SECRET = 'secret-for-tests';
  const t = signDevToken('Dev.Demo@tendrils.io');
  assert.equal(verifyDevToken(t), 'dev.demo@tendrils.io');
  assert.equal(verifyDevToken(t.slice(0, -2) + 'xx'), null);
  assert.equal(verifyDevToken(signDevToken('x@y.z').split('.')[0] + '.' + t.split('.')[1]), null);
  assert.equal(verifyDevToken('garbage'), null);
  assert.ok(isDemoEmail('maya.demo@tendrils.io') && isDemoEmail('c.demo@sofabed.test'));
  assert.ok(!isDemoEmail('shreenand@tendrils.io') && !isDemoEmail('demo@tendrils.io'));
});

test('dev login is OFF unless DEV_LOGIN=true and not production', () => {
  const cookie = `${DEV_COOKIE}=${signDevToken('maya.demo@tendrils.io')}`;
  Object.assign(process.env, { DEV_LOGIN: 'false', NODE_ENV: 'development' });
  assert.equal(isDevLoginEnabled(), false);
  assert.equal(devEmailFromCookieHeader(cookie), null);
  Object.assign(process.env, { DEV_LOGIN: 'true', NODE_ENV: 'production' });
  assert.equal(devEmailFromCookieHeader(cookie), null, 'never in production');
  Object.assign(process.env, { DEV_LOGIN: 'true', NODE_ENV: 'development' });
  assert.equal(devEmailFromCookieHeader(cookie), 'maya.demo@tendrils.io');
  // a real (non-demo) email can never be impersonated, even with a valid signature
  assert.equal(devEmailFromCookieHeader(`${DEV_COOKIE}=${signDevToken('shreenand@tendrils.io')}`), null);
});
