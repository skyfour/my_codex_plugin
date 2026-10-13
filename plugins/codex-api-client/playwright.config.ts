import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'tests',testMatch:'ui.spec.ts',workers:1,use:{headless:true,channel:'chrome',viewport:{width:1440,height:1000}},reporter:'list',webServer:{command:'node --experimental-sqlite scripts/ui-fixture.mjs',url:'http://127.0.0.1:47891',reuseExistingServer:false,timeout:20000}});
