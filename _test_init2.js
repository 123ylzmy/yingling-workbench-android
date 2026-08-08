const fs = require('fs');

// Better browser environment mock
const mockDoc = {
  getElementById: () => null,
  body: { appendChild: () => {}, innerHTML: '' },
  createElement: () => ({}),
  addEventListener: () => {},
  querySelector: () => null,
  querySelectorAll: () => [],
  head: { appendChild: () => {} },
  title: '',
  hidden: false,
  createTextNode: () => ({}),
};
globalThis.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => {},
  location: { href: 'http://localhost:3000/index.html', replace: () => {}, origin: 'http://localhost:3000' },
  __auth: null,
  __profile: { nickname: '测试', avatar_idx: 0, gender: '' },
};
globalThis.document = mockDoc;
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.navigator = { serviceWorker: null, onLine: true };
globalThis.setTimeout = (fn, ms) => { fn(); return 1; };
globalThis.clearTimeout = () => {};
globalThis.setInterval = () => 1;
globalThis.clearInterval = () => {};
globalThis.console = { log: () => {}, warn: () => {}, error: (...a) => { consoleErrors.push(a); } };
var consoleErrors = [];

globalThis.fetch = function(url) {
  return new Promise((resolve, reject) => {
    if (url === 'data.json' || url.endsWith('/data.json')) {
      try {
        const text = fs.readFileSync('data.json', 'utf8');
        resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(text)), headers: { get: () => 'application/json' } });
      } catch(e) { reject(e); }
    } else if (url.includes('supabase.co')) {
      resolve({ ok: true, json: () => Promise.resolve([]), headers: { get: () => 'application/json' } });
    } else {
      reject(new Error('Unknown URL: ' + url));
    }
  });
};

process.on('unhandledRejection', (reason) => {
  consoleErrors.push(['UNHANDLED REJECTION:', reason?.message || reason]);
});

try {
  require('./index.js');
  console.log('[Test] index.js loaded successfully');
} catch (e) {
  console.error('[Test] Load error:', e.message);
}

// Wait a bit for async operations
setTimeout(() => {
  if (consoleErrors.length > 0) {
    console.log('\n=== ERRORS ===');
    consoleErrors.forEach(err => console.log(JSON.stringify(err)));
  }
  if (mockDoc.body.innerHTML.includes('数据加载失败')) {
    console.log('\n!!! ERROR DETECTED: 数据加载失败 page shown !!!');
    console.log('Body HTML:', mockDoc.body.innerHTML.substring(0, 500));
  } else {
    console.log('\n[Test] No 数据加载失败 detected');
  }
}, 1000);
