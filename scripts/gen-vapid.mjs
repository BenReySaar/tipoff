// Creates the key pair the server uses to sign push notifications. Run once: npm run vapid
import crypto from 'node:crypto';

const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-65);
const pub = raw.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwk = JSON.stringify(privateKey.export({ format: 'jwk' }));

console.log('\n1) Put this line in wrangler.toml under [vars]:\n');
console.log(`VAPID_PUBLIC = "${pub}"\n`);
console.log('2) Run this command and paste the value below when it asks (keep it secret):\n');
console.log('npx wrangler secret put VAPID_PRIVATE_JWK\n');
console.log(jwk + '\n');
