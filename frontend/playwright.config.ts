import {defineConfig,devices} from '@playwright/test';
const port=process.env.TEST_PORT || '5173';
const baseURL=`http://127.0.0.1:${port}`;
export default defineConfig({testDir:'./tests',workers:1,timeout:180000,expect:{timeout:15000},reporter:[['list'],['json',{outputFile:'test-results/results.json'}]],use:{baseURL,trace:'retain-on-failure'},webServer:process.env.TEST_EXTERNAL_SERVER ? undefined : {command:`npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,url:baseURL,reuseExistingServer:!process.env.CI},projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'mobile',use:{...devices['iPhone 13'],defaultBrowserType:'chromium'}}]});

