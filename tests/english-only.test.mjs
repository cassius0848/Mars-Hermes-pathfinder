import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {language,t,localizeData} from '../web/locale.js';
import {english} from '../web/locale-text.js';

test('workers and imported system labels always use English',()=>{
  assert.equal(language,'en');
  assert.equal(t('出发地'),'Start');
  assert.equal(t('返航'),'Return');
  assert.deepEqual(localizeData({label:'出发地',notes:['返航','user note']}),{label:'Start',notes:['Return','user note']});
  for(const value of Object.values(english))assert.doesNotMatch(value,/\p{Script=Han}/u);
});

test('legacy Chinese URLs and saved preferences cannot enable a Chinese interface',async()=>{
  const keys=['document','location','localStorage'],old=Object.fromEntries(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  try {
    Object.defineProperties(globalThis,{
      document:{configurable:true,value:{documentElement:{lang:'zh-CN'}}},
      location:{configurable:true,value:{search:'?area=jezero&lang=zh'}},
      localStorage:{configurable:true,value:{getItem:()=> 'zh'}},
    });
    const locale=await import('../web/locale.js?legacy-chinese-preference');
    assert.equal(locale.language,'en');locale.initLanguage();assert.equal(document.documentElement.lang,'en');
    assert.equal(locale.t('出发地'),'Start');
  } finally {for(const key of keys){if(old[key])Object.defineProperty(globalThis,key,old[key]);else delete globalThis[key];}}
});

test('every browser entry is English without a language switch or Chinese markup',async()=>{
  for(const name of ['index','atlas','mission']){
    const html=await readFile(new URL(`../web/${name}.html`,import.meta.url),'utf8');
    assert.match(html,/<html lang="en">/);assert.doesNotMatch(html,/language-switch|Switch to Chinese|\p{Script=Han}/u);
  }
  const dictionary=await import('../web/locale-text.js');assert.equal('chineseMarkup' in dictionary,false);
});
