import { defineConfig } from '@playwright/test';
const port=process.env.STATIC_TEST_PORT || '4173';
const basePath=process.env.VITE_BASE_PATH || '/Aiot-HW2/';
export default defineConfig({
  testDir:'./tests-static',workers:1,timeout:90000,expect:{timeout:20000},
  reporter:[['list'],['json',{outputFile:'test-results/static-results.json'}]],
  use:{baseURL:`http://127.0.0.1:${port}${basePath}`,trace:'retain-on-failure',
    channel:process.env.PLAYWRIGHT_CHANNEL || undefined},
  webServer:{command:`node node_modules/vite/bin/vite.js preview --mode static --host 127.0.0.1 --port ${port} --strictPort`,
    url:`http://127.0.0.1:${port}${basePath}`,reuseExistingServer:false},
  projects:[{name:'desktop-static',use:{viewport:{width:1440,height:1000}}},
    {name:'mobile-static',use:{viewport:{width:390,height:844},isMobile:true,hasTouch:true}}],
});
