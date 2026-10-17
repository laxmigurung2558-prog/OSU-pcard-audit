'use strict';
// Audit analysis using local transaction records; Gemini interprets questions via private Flask backend.
const YEARS=[2010,2011,2012,2013,2014], cache=new Map();
const $=id=>document.getElementById(id);
const html=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const usd=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(n)||0);
const number=n=>Number(n).toLocaleString('en-US');
const cols=[['date','Transaction date'],['posted','Posted date'],['name','Cardholder'],['vendor','Vendor'],['description','Description'],['amount','Amount'],['mcc','MCC']];
// Array positions correspond to exported rows from pcards.db.
function hydrate(row){return {date:row[0],posted:row[1],name:row[2],vendor:row[3],description:row[4],amount:Number(row[5]),mcc:row[6],initial:row[7],last:row[8]};}
// Load year-specific JavaScript files. Unlike fetch(JSON), classic script tags
// also work when the auditor opens index.html directly using Safari file://.
window.PCARD_DATA=window.PCARD_DATA||{};
const pending=new Map();
async function getYear(year){
  year=Number(year);
  if(cache.has(year))return cache.get(year);
  if(pending.has(year))return pending.get(year);
  $('status').textContent=`Loading ${year} transactions…`;
  const loading=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src=`data/${year}.js`;
    script.onload=()=>{
      try{
        const raw=window.PCARD_DATA[year];
        if(!Array.isArray(raw))throw Error(`Missing transaction data for ${year}`);
        const rows=raw.map(hydrate);
        delete window.PCARD_DATA[year];
        cache.set(year,rows);
        $('status').textContent=`Real OSU dataset loaded · ${number(rows.length)} transactions in ${year} · ${YEARS[0]}–${YEARS.at(-1)} available`;
        resolve(rows);
      }catch(error){reject(error)}finally{script.remove();}
    };
    script.onerror=()=>{script.remove();reject(Error(`Cannot load data/${year}.js. Keep the data folder beside index.html.`));};
    document.head.appendChild(script);
  });
  pending.set(year,loading);
  try{return await loading;}finally{pending.delete(year);}
}
function showError(target,e){$(target).innerHTML=`<strong>Unable to load data.</strong> ${html(e.message)}<p>Make sure the <strong>data</strong> folder is alongside index.html, then reload the page.</p>`;$('status').textContent='Data loading error';}
const PAGE=100;
function display(target,title,rows,columns=cols,explanation='',metrics=null){let current=0;const root=$(target),stateRows=rows;function render(){const start=current*PAGE, view=stateRows.slice(start,start+PAGE),end=Math.min(start+PAGE,stateRows.length);root.innerHTML=`<h3>${html(title)}</h3>${explanation?`<p class="explain">${html(explanation)}</p>`:''}<div class="metrics"><div class="metric"><strong>${number(stateRows.length)}</strong>Matching rows</div>${metrics?`<div class="metric"><strong>${usd(metrics)}</strong>Combined amount</div>`:''}</div>${rows.length?`<div class="paging"><span>Showing ${number(start+1)}–${number(end)} of ${number(rows.length)} rows</span><div><button id="prev_${target}" ${current===0?'disabled':''}>Previous</button> <button id="next_${target}" ${end>=rows.length?'disabled':''}>Next</button></div></div><table><thead><tr>${columns.map(c=>`<th>${html(c[1])}</th>`).join('')}</tr></thead><tbody>${view.map(r=>`<tr>${columns.map(c=>`<td class="${c[0]==='amount'||c[0]==='total'?'number':''}">${c[0]==='amount'||c[0]==='total'?usd(r[c[0]]):html(r[c[0]]??'—')}</td>`).join('')}</tr>`).join('')}</tbody></table>`:'<p>No matches. Try a different keyword or year.</p>'}`;if(rows.length){$(`prev_${target}`).onclick=()=>{current--;render();};$(`next_${target}`).onclick=()=>{current++;render();};}}render();}
function filterKeyword(rows,field,keyword){return rows.filter(r=>String(r[field]??'').toLowerCase().includes(keyword.toLowerCase()));}
async function search(mode){const target='dashResult',year=$(`${mode}Year`).value,field=mode==='desc'?'description':'vendor',keyword=$(`${mode}Keyword`).value.trim();if(!keyword){$(target).textContent='Please enter a search keyword.';return;}$(target).textContent='Searching…';try{const all=await getYear(year), matches=filterKeyword(all,field,keyword).sort((a,b)=>b.amount-a.amount),total=matches.reduce((s,r)=>s+r.amount,0);display(target,`${mode==='desc'?'Description':'Vendor'} matches: “${keyword}” (${year})`,matches,cols,`Case-insensitive substring match in ${field} only. Screening result, not proof of an exception.`,total);}catch(e){showError(target,e);}}
function duplicateRows(rows){const m=new Map();for(const r of rows){if(r.amount<=0)continue;const key=JSON.stringify([r.date,r.vendor,r.initial,r.last,r.amount]);if(!m.has(key))m.set(key,[]);m.get(key).push(r);}return [...m.values()].filter(g=>g.length>1).flat().sort((a,b)=>String(a.date).localeCompare(String(b.date)));}
function getVendorFromQuestion(q){const match=q.match(/(?:at|from|vendor|merchant)\s+["']?([\w&.\s'-]+?)["']?\s*\??$/i);return match?match[1].trim().replace(/\s+in\s+20\d{2}$/,'').trim():null;}
async function askQuestion(raw){const target='askResult',q=raw.trim(),lower=q.toLowerCase();if(!q)return;const explicitYear=q.match(/\b(201[0-4])\b/);const year=explicitYear?Number(explicitYear[1]):Number($('askYear').value);$('askYear').value=String(year);$(target).textContent='Analyzing…';try{const rows=await getYear(year);let result=[],title='',explanation='',columns=cols,total=null;
if(/duplicat|double.payment/.test(lower)){result=duplicateRows(rows);title='Potential duplicate payments';explanation='Positive charges sharing transaction date, vendor, cardholder last name, first initial and amount. Multiple legitimate charges may match.';}
else if(/just below|near.{0,20}5,?000|under.{0,12}5,?000/.test(lower)){result=rows.filter(r=>r.amount>=4900&&r.amount<5000).sort((a,b)=>b.amount-a.amount);title='Charges just below $5,000';explanation='Amount ≥ $4,900 and < $5,000.';}
else if(/above.{0,12}5,?000|over.{0,12}5,?000|exceed.{0,15}5,?000|more than.{0,12}5,?000/.test(lower)){result=rows.filter(r=>r.amount>5000).sort((a,b)=>b.amount-a.amount);title='Transactions above $5,000';explanation='Amount > $5,000, single-transaction review threshold.';}
else if(/employee|cardholder|person|who spent|top spender/.test(lower)&&/most|top|highest|spent|spending|total/.test(lower)){const map=new Map();for(const r of rows)map.set(r.name,(map.get(r.name)||0)+r.amount);result=[...map].map(([name,total])=>({name,total})).sort((a,b)=>b.total-a.total);title='Spending by cardholder';columns=[['name','Cardholder'],['total','Net total spend']];explanation='Grouped by FullName; includes refunds/credits (negative amounts).';}
else if(/largest|biggest|highest|top.{0,12}transaction/.test(lower)){result=[...rows].sort((a,b)=>b.amount-a.amount).slice(0,100);title='100 largest transactions';explanation='Sorted by transaction amount descending.';}
else if(/how many|number of transactions|transaction count|count transactions/.test(lower)&&!/insurance|gift|alcohol|gas|postage|membership|cash|atm|vendor/.test(lower)){result=[{year,quantity:rows.length}];title='Transaction count';columns=[['year','Calendar year'],['quantity','Transactions']];explanation='All OSU P-Card records for selected calendar year.';}
else {const vendor=getVendorFromQuestion(q);if(vendor){result=filterKeyword(rows,'vendor',vendor).sort((a,b)=>b.amount-a.amount);title=`Vendor: ${vendor}`;explanation='Vendor-name substring search. Includes credits/returns.';}
else {const term=['alcohol','insurance','gift','gasoline','gas','postage','mail','membership','cash','atm','decoration','donation','moving','personal','salary','wage','benefit','award','late fee','restaurant','hotel','paypal','florist'].find(w=>lower.includes(w));if(term){result=rows.filter(r=>[r.description,r.vendor,r.mcc].some(v=>String(v||'').toLowerCase().includes(term))).sort((a,b)=>b.amount-a.amount);title=`Keyword screening: ${term}`;explanation='Matches Description OR Vendor OR MCC. The dedicated dashboard searches only the field you select.';}else{$(target).innerHTML='<strong>This question is not supported yet.</strong><p>Try the example questions, or ask about spending by employee, largest transactions, transaction counts, duplicates, $5,000 limits, a known vendor, or a prohibited-purchase keyword. This tool does not invent answers.</p>';return;}}}
if(columns===cols)total=result.reduce((s,r)=>s+r.amount,0);display(target,`${title} · ${year}`,result,columns,explanation,total);}catch(e){showError(target,e);}}

// Interpret natural language with Gemini; query real transactions locally using approved filters.
async function askGemini(raw){
  const target='askResult', q=raw.trim();
  if(!q)return;
  $(target).textContent='Asking Gemini to interpret your question…';
  const response=await fetch('/api/interpret',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:q})
  });
  const plan=await response.json();
  if(!response.ok)throw new Error(plan.error||'Gemini service unavailable');
  if(plan.intent==='unknown'){
    $(target).innerHTML='<strong>That question needs a different analysis.</strong><p>Try asking for a count, total spending, a transaction list, or spending grouped by cardholder or vendor.</p>';
    return;
  }
  const year=/\b201[0-4]\b/.test(q)?plan.year:Number($('askYear').value);
  $('askYear').value=String(year);
  let rows=[...await getYear(year)];
  const keyMap={Description:'description',Vendor:'vendor',MCC:'mcc',FullName:'name',Amount:'amount',TransactionDate:'date'};
  const field=keyMap[plan.field];
  const keyword=String(plan.keyword||'').trim().toLowerCase();
  if(keyword){
    if(!field){$(target).textContent='Gemini returned a search without a valid field.';return;}
    rows=rows.filter(r=>String(r[field]??'').toLowerCase().includes(keyword));
  }
  // Group-total thresholds apply AFTER aggregation, not to individual purchases.
  const isAnnualCardholderThreshold = plan.intent==='group' && plan.group_by==='FullName' &&
    Number(plan.group_min_total)>0;
  if(!isAnnualCardholderThreshold && plan.min_amount!==null)rows=rows.filter(r=>plan.min_exclusive ? r.amount>Number(plan.min_amount) : r.amount>=Number(plan.min_amount));
  if(plan.max_amount!==null)rows=rows.filter(r=>r.amount<=Number(plan.max_amount));
  const sum=rows.reduce((s,r)=>s+r.amount,0);
  const limit=Math.min(100,Math.max(1,Number(plan.limit)||50));
  const criteria=`Gemini interpreted: ${plan.intent}; year ${year}; ${field&&keyword?`${plan.field} contains “${keyword}”; `:''}${plan.min_amount!==null?`amount ${plan.min_exclusive?'>':'≥'} ${usd(plan.min_amount)}; `:''}${plan.max_amount!==null?`amount ≤ ${usd(plan.max_amount)}; `:''}results are calculated from your local OSU records, not generated by Gemini.`;
  if(plan.intent==='count'){
    $(target).innerHTML=`<h3>Transaction count · ${year}</h3><p class="explain">${html(criteria)}</p><div class="metrics"><div class="metric"><strong>${number(rows.length)}</strong>Matching transactions</div></div>`;
  } else if(plan.intent==='sum'){
    display(target,`Total transaction amount · ${year}`,[{total:sum,quantity:rows.length}],[['total','Net amount'],['quantity','Transactions']],criteria);
  } else if(plan.intent==='group'){
    const groupField=keyMap[plan.group_by];
    if(!groupField){$(target).textContent='Please specify grouping by cardholder, vendor, or MCC.';return;}
    const map=new Map();
    for(const r of rows){const k=String(r[groupField]||'—');const v=map.get(k)||{group:k,total:0,quantity:0};v.total+=r.amount;v.quantity++;map.set(k,v);}
    let groups=[...map.values()];
    if(isAnnualCardholderThreshold) groups=groups.filter(g => plan.group_min_exclusive ? g.total>Number(plan.group_min_total) : g.total>=Number(plan.group_min_total));
    groups.sort((a,b)=>plan.sort==='count_desc'?b.quantity-a.quantity:b.total-a.total);
    const totalGroups=groups.length;
    const shown=groups.slice(0,limit);
    const extra=isAnnualCardholderThreshold ? ` Annual employee spending ${plan.group_min_exclusive?'>':'≥'} ${usd(plan.group_min_total)}; ${number(totalGroups)} qualifying employees. Showing ${number(shown.length)}.` : ` Showing ${number(shown.length)} of ${number(totalGroups)} groups.`;
    display(target,`Spending by ${plan.group_by} · ${year}`,shown,[['group',plan.group_by],['quantity','Transactions'],['total','Net amount']],criteria+extra);
  }else{
    if(plan.sort==='amount_asc')rows.sort((a,b)=>a.amount-b.amount);
    else if(plan.sort==='date_asc')rows.sort((a,b)=>String(a.date).localeCompare(String(b.date)));
    else rows.sort((a,b)=>b.amount-a.amount);
    const shown=rows.slice(0,limit);
    display(target,`Matching transactions · ${year}`,shown,cols,`${criteria} Showing ${number(shown.length)} of ${number(rows.length)} matches.`,shown.reduce((s,r)=>s+r.amount,0));
  }
}
async function askWithGemini(question){
  try{await askGemini(question);}catch(error){
    $('askResult').innerHTML=`<strong>Gemini is unavailable:</strong> ${html(error.message)}<p>You can still use the original question patterns and dashboard.</p><button id="fallbackAsk">Use basic search instead</button>`;
    $('fallbackAsk').onclick=()=>askQuestion(question);
  }
}

for(const sel of document.querySelectorAll('.year')){sel.innerHTML=YEARS.map(y=>`<option value="${y}" ${y===2014?'selected':''}>${y}</option>`).join('');}
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(t=>{t.classList.toggle('active',t===b);t.setAttribute('aria-selected',String(t===b));});document.querySelectorAll('.panel').forEach(p=>p.classList.toggle('active',p.id===b.dataset.tab));});
$('askForm').onsubmit=e=>{e.preventDefault();askWithGemini($('question').value);};
document.querySelectorAll('[data-question]').forEach(b=>b.onclick=()=>{$('question').value=b.dataset.question;askWithGemini(b.dataset.question);});
$('descForm').onsubmit=e=>{e.preventDefault();search('desc');};$('vendorForm').onsubmit=e=>{e.preventDefault();search('vendor');};
getYear(2014).catch(e=>showError('askResult',e));
