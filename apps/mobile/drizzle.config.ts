import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: '../../packages/shared/src/schema.ts',
  out: '../../packages/shared/drizzle',
  dialect: 'sqlite',
  driver: 'expo',
})
