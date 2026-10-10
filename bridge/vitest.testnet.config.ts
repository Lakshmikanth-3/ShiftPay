import 'dotenv/config';
import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['testnet/**/*.test.ts'],testTimeout:60000,hookTimeout:60000,fileParallelism:false}});
