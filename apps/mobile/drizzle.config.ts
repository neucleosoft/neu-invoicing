import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: '../../packages/shared/src/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  driver: 'expo',
})
