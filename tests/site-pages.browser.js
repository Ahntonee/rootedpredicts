// Runs the real dashboard and formatter in headless Chrome with a mock API.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const root = path.resolve(__dirname, '..');
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rooted-pages-test-'));
const html = fs.readFileSync(path.join(root, 'public/admin/pages.html'), 'utf8');
const pageScript = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('loadAllPages'));
const editorScript = fs.readFileSync(path.join(root, 'public/js/page-editor.js'), 'utf8');
const categories = Object.keys(require('../services/categoryPages').categories);
const boot = `
window.testErrors = [];
window.addEventListener('error', e => testErrors.push(e.message));
const mockPages = [{slug:'home',content:'<p>Home article</p>'}, {slug:'about',content:'<h2>About us</h2><p>Original about</p>',extra:{stat_accuracy:'75%'}}];
for (const slug of ${JSON.stringify(categories)}) mockPages.push({slug:'category-'+slug,kind:'category',label:slug,url:'/predictions/'+slug,content:'<h2>Original heading</h2><p>Original text</p>'});
window.confirm = () => true;
window.mockFail = false;
window.Admin = {
 requireAdmin: async () => ({name:'Test admin'}), buildSidebar() {}, toast() {},
 api: async (method, url, payload) => {
  if (mockFail) return {success:false,message:'Simulated failure'};
  if (method === 'GET') return {success:true,pages:structuredClone(mockPages)};
  const slug = url.split('/').pop();
  Object.assign(mockPages.find(p=>p.slug===slug), payload);
  return {success:true};
 }
};
`;
const checks = `
const check = (value,message) => { if(!value) throw new Error(message); };
window.addEventListener('DOMContentLoaded', () => setTimeout(async () => {
 try {
  check(pageEditor && loadedSlug === 'home', 'Editor must initialize and load home');
  check(document.querySelectorAll('#category-page-tabs button').length === 10, 'All category tabs');
  const tab=document.querySelector('[data-slug="category-1-5-goals"]');
  tab.click();
  check(loadedSlug === 'category-1-5-goals', 'Category selection');
  const paragraph=pageEditor.visual.querySelector('p');
  const range=document.createRange(); range.selectNodeContents(paragraph);
  const selection=window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  pageEditor.range=range;
  pageEditor.command('bold');
  check(/<(b|strong)>Original text/.test(pageEditor.getContent()), 'Bold formatting');
  await savePage();
  const saved=mockPages.find(p=>p.slug==='category-1-5-goals').content;
  check(saved===pageEditor.getContent() && !dirty, 'Formatted save');
  document.querySelector('[data-slug="about"]').click();
  check(pageEditor.getContent().includes('Original about'), 'About loaded');
  tab.click(); check(pageEditor.getContent()===saved, 'Reopen preserves formatting');
  pageEditor.toggleSource();
  pageEditor.source.value='<h2>Source heading</h2><ol><li><em>First</em></li></ol>';
  pageEditor.source.dispatchEvent(new Event('input',{bubbles:true}));
  pageEditor.toggleSource();
  check(pageEditor.visual.querySelector('ol em').textContent==='First', 'Source to visual');
  await savePage();
  removeArticle(); await savePage();
  check(mockPages.find(p=>p.slug==='category-1-5-goals').content==='', 'Removal persisted');
  pageEditor.setContent('<h2>Restored article</h2>'); markDirty(); await savePage();
  check(mockPages.find(p=>p.slug==='category-1-5-goals').content.includes('Restored'), 'Article restored');
  pageEditor.setContent('<p>Unsaved work</p>'); markDirty(); mockFail=true; await savePage();
  check(dirty && !saving && !document.getElementById('editor-wrap').inert, 'Failed save preserves editing');
  mockFail=false;
  check(!testErrors.length, testErrors.join(';'));
  document.body.innerHTML='<pre id="test-result">PASS: dashboard loads; 10 category tabs; bold formatting; save and reopen; HTML source; remove and restore; failed-save recovery.</pre>';
 } catch(error) { document.body.innerHTML='<pre id="test-result"></pre>'; document.getElementById('test-result').textContent='FAIL: '+error.stack; }
},100));
`;
const fixture = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, '')
  .replace('</body>', `<script>${boot}</script><script>${editorScript}</script><script>${pageScript}</script><script>${checks}</script></body>`);
const filename = path.join(tmp, 'dashboard.html');
fs.writeFileSync(filename, fixture);
const result = spawnSync(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--user-data-dir=' + path.join(tmp, 'profile'), '--virtual-time-budget=4000', '--dump-dom', pathToFileURL(filename).href], { encoding:'utf8', timeout:30000, maxBuffer:2*1024*1024, windowsHide:true });
const output = result.stdout || '';
const match = output.match(/<pre id="test-result">([\s\S]*?)<\/pre>/);
if (!match || !match[1].startsWith('PASS:')) {
  console.error(match ? match[1] : result.error || result.stderr || 'Browser did not finish');
  process.exitCode = 1;
} else console.log(match[1]);
