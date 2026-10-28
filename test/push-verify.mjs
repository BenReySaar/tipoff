// Optional check of the push encryption against an independent library: npm i -D http_ece@1.2.0 && node test/push-verify.mjs
import crypto from 'node:crypto';
import ece from 'http_ece';
import { encryptPayload, vapidHeader, b64u, unb64u } from '../src/push.js';

// a "browser": receiver key pair + auth secret
const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
const auth = crypto.randomBytes(16);
const payload = { title: 'המשחק זז', body: 'מכבי גדרה – ראשון 1.11 ב־18:30 (היה 17:00)', url: '/' };
const body = await encryptPayload(payload, b64u(ua.getPublicKey()), b64u(auth));
const out = ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: ua, authSecret: auth });
console.log('decrypted by http_ece:', out.toString('utf8'));
if (JSON.parse(out.toString('utf8')).body !== payload.body) throw new Error('mismatch');

// VAPID: sign with our code, verify with node's crypto
const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = privateKey.export({ format: 'jwk' });
const pubRaw = b64u(publicKey.export({ format: 'der', type: 'spki' }).subarray(-65));
const h = await vapidHeader('https://fcm.googleapis.com/fcm/send/abc', { publicKey: pubRaw, privateJwk: jwk, subject: 'mailto:test@example.com' });
const [, jwt] = h.match(/^vapid t=([^,]+), k=/);
const [hd, cl, sig] = jwt.split('.');
const okSig = crypto.verify('sha256', Buffer.from(hd + '.' + cl), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(unb64u(sig)));
console.log('vapid claims:', Buffer.from(unb64u(cl)).toString(), 'signature valid:', okSig);
if (!okSig) throw new Error('bad signature');
