// UI tests serve static assets only. Business API calls are intercepted by Playwright.
require('express')().use(require('express').static('public')).listen(4318, '127.0.0.1');
