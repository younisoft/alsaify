#!/usr/bin/env node
// Generates the install QR code for a VERIFIED https URL: node scripts/make-qr.mjs https://<project>.web.app
import QRCode from 'qrcode';
const url = process.argv[2];
if (!url || !/^https:\/\//.test(url)) { console.error('An https:// URL is required'); process.exit(1); }
await QRCode.toFile('docs/install-qr.png', url, { width: 600, margin: 2, color: { dark: '#10243A', light: '#FFFFFF' } });
console.log(await QRCode.toString(url, { type: 'terminal', small: true }));
console.log('Saved docs/install-qr.png →', url);
