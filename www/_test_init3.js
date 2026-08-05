const fs = require('fs');
const path = require('path');

// Change cwd to script directory
process.chdir(__dirname);

console.log('[TEST] Starting... cwd =', process.cwd());

// Better browser environment mock
const mockDoc = {
  getElementById: () => null,
  body: { appendChild: () => {}, innerHTML: '' },
  createElement: () => ({ style: {} }),
  addEventListener: () => {},
  querySelector: () => null,
  querySelectorAll: () => [],
  head: { appendChild: () => {} },
  title: '',
  hidden: false,
  createTextNode: () => ({}),
  documentElement: {
    setAttribute: () => {},
    removeAttribute: () => {},
    style: { setProperty: () => {}, removeProperty: () => {} }
  }
};
globalThis.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => {},
  location: { href: 'http://localhost:3000/index.html', replace: () => {}, origin: 'http://localhost:3000' },
  __auth: { user: { id: 'test123' }, access_token: 'test', expires_at: 9999999999, _local: true },
  __profile: { nickname: '测试用户', avatar_idx: 0, gender: '' },
};
globalThis.document = mockDoc;
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.navigator = { serviceWorker: null, onLine: true };

// Keep real setTimeout/clearTimeout for async flow
const realSetTimeout = setTimeout;
const realClearTimeout = clearTimeout;

var consoleErrors = [];
globalThis.console = {
  log: (...a) => { process.stdout.write('[LOG] ' + a.join(' ') + '\n'); },
  warn: (...a) => { process.stdout.write('[WARN] ' + a.join(' ') + '\n'); },
  error: (...a) => { consoleErrors.push(a); process.stdout.write('[ERROR] ' + a.join(' ') + '\n'); }
};

globalThis.fetch = function(url) {
  console.log('[FETCH] url =', url);
  return new Promise((resolve, reject) => {
    if (url === 'data.json' || url.endsWith('/data.json')) {
      try {
        const text = fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8');
        console.log('[FETCH] data.json loaded, size =', text.length);
        resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(JSON.parse(text)),
          headers: { get: () => 'application/json' }
        });
      } catch(e) {
        console.log('[FETCH] data.json error:', e.message);
        reject(e);
      }
    } else if (url.includes('supabase.co')) {
      console.log('[FETCH] Supabase API call (mocked)');
      resolve({
        ok: true,
        json: () => Promise.resolve([]),
        headers: { get: () => 'application/json' }
      });
    } else {
      console.log('[FETCH] Unknown URL rejected:', url);
      reject(new Error('Unknown URL: ' + url));
    }
  });
};

process.on('unhandledRejection', (reason) => {
  console.log('[UNHANDLED]', reason?.message || reason);
});

console.log('[TEST] Loading index.js...');
try {
  require('./index.js');
  console.log('[TEST] index.js loaded successfully');
} catch (e) {
  console.log('[TEST] Load error:', e.message);
  console.log(e.stack);
}

// Wait for async to settle
realSetTimeout(() => {
  if (consoleErrors.length > 0) {
    console.log('\n=== CONSOLE ERRORS ===');
    consoleErrors.forEach(err => console.log(err.join(' ')));
  }
  if (mockDoc.body.innerHTML && mockDoc.body.innerHTML.includes('数据加载失败')) {
    console.log('\n!!! ERROR: 数据加载失败 page shown !!!');
    console.log('Body HTML (first 300 chars):', mockDoc.body.innerHTML.substring(0, 300));
  } else {
    console.log('\n[TEST] No 数据加载失败 detected - page loaded OK');
  }
  process.exit(0);
}, 2000);
