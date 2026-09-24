const { defineConfig, devices } = require('@playwright/test');
module.exports = defineConfig({
    testDir: './test/browser', timeout: 20000, workers: 1,
    use: { baseURL: 'http://127.0.0.1:4318', channel: 'chrome', headless: true, screenshot: 'only-on-failure' },
    projects: [
        { name: 'desktop-chrome', grepInvert: /@android/ },
        { name: 'android-chrome', grep: /@android/, use: { ...devices['Pixel 5'], channel: 'chrome' } }
    ],
    webServer: { command: 'node test/static-server.js', url: 'http://127.0.0.1:4318/dashboard.html', reuseExistingServer: false },
    reporter: 'list'
});
