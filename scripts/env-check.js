#!/usr/bin/env node
/*
 * Quick, dependency-free environment validator for CI gates. It ensures
 * operators know which secrets/URLs are missing before booting the backend.
 */
const required = ['PORT', 'HOST']
const optional = ['POSTGRES_URL', 'DATABASE_URL', 'BEARER_TOKEN', 'JWT_SECRET']

let missing = []
for (const key of required) {
  if (!process.env[key]) missing.push(key)
}

if (missing.length) {
  console.error('[env-check] missing required variables:', missing.join(', '))
  process.exitCode = 1
} else {
  console.log('[env-check] required keys present')
}

for (const key of optional) {
  if (!process.env[key]) {
    console.warn(`[env-check] ${key} not set; using memory storage or open auth defaults.`)
  }
}
