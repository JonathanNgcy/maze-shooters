import { defineConfig } from 'vitest/config';
export default defineConfig({test:{include:['tests/{sim,maze,local,client,network}/**/*.test.ts']},server:{host:'127.0.0.1',proxy:{'/duel':{target:'ws://127.0.0.1:8787',ws:true}}},preview:{proxy:{'/duel':{target:'ws://127.0.0.1:8787',ws:true}}}});
