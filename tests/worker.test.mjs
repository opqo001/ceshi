import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
const ORIGIN='https://moving.example';
class MemoryBucket {
  objects = new Map();
  async put(key,value,options={}) {
    if(options.onlyIf?.etagDoesNotMatch==='*' && this.objects.has(key)) return null;
    this.objects.set(key,value); return {key};
  }
  async get(key) {
    const data=this.objects.get(key);
    return data === undefined ? null : {json:async()=>JSON.parse(data)};
  }
  async list({prefix,limit,cursor}) {
    const keys=[...this.objects.keys()].filter(key=>key.startsWith(prefix)).sort();
    const offset=Number(cursor||0);
    const selected=keys.slice(offset,offset+limit);
    return {objects:selected.map(key=>({key})),truncated:offset+limit<keys.length,cursor:String(offset+limit)};
  }
}
function environment() {
  return {
    BOOKINGS:new MemoryBucket(),ADMIN_PASSWORD:'123',SESSION_SECRET:'a'.repeat(64),
    ADMIN_LOGIN_RATE_LIMITER:{limit:async()=>({success:true})},BOOKING_RATE_LIMITER:{limit:async()=>({success:true})},
    ASSETS:{fetch:async request=>new Response(new URL(request.url).pathname.endsWith('login.html')?'<title>Admin sign in</title>':'<title>Booking requests</title>',{headers:{'Content-Type':'text/html'}})}
  };
}
const booking=(extra={})=>({service:'family',fromAddress:'10 Downing Street, London',toAddress:'Manchester Piccadilly, Manchester',phone:'+44 7700 900123',moveDate:new Date(Date.now()+86400000).toISOString().slice(0,10),...extra});
const request=(path,method='GET',data,headers={})=>new Request(ORIGIN+path,{method,headers:{...(data!==undefined?{'Content-Type':'application/json',Origin:ORIGIN}:{}),...headers},...(data!==undefined?{body:JSON.stringify(data)}:{})});
async function login(env,password='123') {
  const response=await worker.fetch(request('/api/admin/login','POST',{password}),env);
  return {response,cookie:response.headers.get('Set-Cookie')?.split(';')[0]};
}
test('a booking is persisted before success; the API exposes only a receipt',async()=>{
 const env=environment(); const response=await worker.fetch(request('/api/bookings','POST',booking()),env);
 assert.equal(response.status,201); const receipt=await response.json(); assert.ok(receipt.id); assert.equal(receipt.phone,undefined);
 assert.equal(env.BOOKINGS.objects.size,1); const saved=JSON.parse([...env.BOOKINGS.objects.values()][0]); assert.equal(saved.phone,'+44 7700 900123');
 assert.equal(response.headers.get('Cache-Control'),'no-store');
});
test('invalid or past dates, bad phone, empty addresses and unknown services do not write to R2',async()=>{
 const env=environment();
 for(const bad of [{moveDate:'2000-01-01'},{moveDate:'2099-02-31'},{phone:'letters'},{fromAddress:' '},{service:'__proto__'}]) {
  assert.equal((await worker.fetch(request('/api/bookings','POST',booking(bad)),env)).status,400);
 }
 assert.equal(env.BOOKINGS.objects.size,0);
});
test('R2 failure cannot produce a successful booking receipt',async()=>{
 const env=environment(); env.BOOKINGS.put=async()=>{throw new Error('storage down')};
 const response=await worker.fetch(request('/api/bookings','POST',booking()),env); assert.equal(response.status,503); assert.ok((await response.json()).error);
});
test('same-origin JSON is required and oversized bodies are rejected',async()=>{
 const env=environment();
 assert.equal((await worker.fetch(request('/api/bookings','POST',booking(),{Origin:'https://other.example'}),env)).status,403);
 assert.equal((await worker.fetch(request('/api/bookings','POST',booking(),{'Content-Type':'text/plain'}),env)).status,415);
 assert.equal((await worker.fetch(request('/api/bookings','POST',booking({extra:'x'.repeat(17000)})),env)).status,413);
});
test('retrying the same submission writes one record; conflicting payloads are rejected',async()=>{
 const env=environment(); const body=booking({submissionId:`${Date.now()}-${crypto.randomUUID()}`});
 const first=await worker.fetch(request('/api/bookings','POST',body),env);const a=await first.json(); assert.equal(first.status,201);
 const retry=await worker.fetch(request('/api/bookings','POST',body),env); assert.equal(retry.status,200); assert.equal((await retry.json()).id,a.id); assert.equal(env.BOOKINGS.objects.size,1);
 assert.equal((await worker.fetch(request('/api/bookings','POST',{...body,toAddress:'A different address'}),env)).status,409);
});
test('admin data is private; the password and signed session both matter',async()=>{
 const env=environment();assert.equal((await worker.fetch(request('/api/admin/bookings'),env)).status,401);
 assert.equal((await login(env,'wrong')).response.status,401);
 const {response,cookie}=await login(env);assert.equal(response.status,200);assert.match(response.headers.get('Set-Cookie'),/HttpOnly; SameSite=Strict/);assert.match(response.headers.get('Set-Cookie'),/Secure/);
 assert.equal((await worker.fetch(request('/api/admin/bookings','GET',undefined,{Cookie:cookie}),env)).status,200);
 const last=cookie.at(-1);const tampered=cookie.slice(0,-1)+(last==='a'?'b':'a');
 assert.equal((await worker.fetch(request('/api/admin/bookings','GET',undefined,{Cookie:tampered}),env)).status,401);
 env.ADMIN_PASSWORD='changed';assert.equal((await worker.fetch(request('/api/admin/bookings','GET',undefined,{Cookie:cookie}),env)).status,401);
});
test('direct admin HTML paths cannot bypass the login gate',async()=>{
 const env=environment();const response=await worker.fetch(request('/admin/index.html'),env);
 assert.match(await response.text(),/Admin sign in/);assert.equal(response.headers.get('Cache-Control'),'no-store');
 const {cookie}=await login(env);assert.match(await (await worker.fetch(request('/admin','GET',undefined,{Cookie:cookie}),env)).text(),/Booking requests/);
});
test('R2 pagination returns 25 records then the remaining records without overlap',async()=>{
 const env=environment();for(let i=0;i<28;i++) await worker.fetch(request('/api/bookings','POST',booking()),env);
 const {cookie}=await login(env);const first=await (await worker.fetch(request('/api/admin/bookings','GET',undefined,{Cookie:cookie}),env)).json();
 assert.equal(first.bookings.length,25);assert.ok(first.cursor);
 const second=await (await worker.fetch(request(`/api/admin/bookings?cursor=${first.cursor}`,'GET',undefined,{Cookie:cookie}),env)).json();
 assert.equal(second.bookings.length,3);assert.equal(second.cursor,null);assert.equal(new Set([...first.bookings,...second.bookings].map(item=>item.id)).size,28);
});
test('missing signing secrets fail closed; rate limits are honoured; logout clears the cookie',async()=>{
 const env=environment();env.SESSION_SECRET='short';assert.equal((await login(env)).response.status,503);
 env.SESSION_SECRET='b'.repeat(64);env.ADMIN_LOGIN_RATE_LIMITER.limit=async()=>({success:false});assert.equal((await login(env)).response.status,429);
 const logout=await worker.fetch(request('/api/admin/logout','POST',{}),env);assert.match(logout.headers.get('Set-Cookie'),/Max-Age=0/);
 env.BOOKING_RATE_LIMITER.limit=async()=>({success:false});assert.equal((await worker.fetch(request('/api/bookings','POST',booking()),env)).status,429);
});
