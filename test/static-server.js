// UI tests serve static assets only. Business API calls are intercepted by Playwright.
const express = require('express');
const path = require('node:path');
express()
    .use('/vendor/fontawesome', express.static(path.join(__dirname, '..', 'node_modules/@fortawesome/fontawesome-free')))
    .use(express.static('public'))
    .listen(4318, '127.0.0.1');
