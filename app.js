// ===== Helpers
const pad=n=> String(n).padStart(2,'0');
const fmtH=ms=>{ const neg=ms<0; ms=Math.abs(ms); const h=Math.floor(ms/3600000), m=Math.floor((ms%3600000)/60000); return (neg?'-':'')+pad(h)+':'+pad(m); };
const now=()=> new Date();
const RULES={
  CONT_MS:4.5*3600000, BREAK_MS:45*60000,
  DAY9:9*3600000, DAY10:10*3600000, WK56:56*3600000, FORT90:90*3600000,
  REST11:11*3600000
};

// ===== Mapa básico (Leaflet)
let map = L.map('map');
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19, attribution:'&copy; OSM'}).addTo(map);
map.setView([39.5,-8.0],6);

// ===== Rota por cliques
let startPt=null, endPt=null, waypoints=[], routeLine=null, planMarks=[];
map.on('click', ev=>{
  const lat=ev.latlng.lat.toFixed(5), lon=ev.latlng.lng.toFixed(5);
  document.getElementById('lastClick').textContent = `${lat}, ${lon}${ev.originalEvent.shiftKey?' (waypoint)':''}`;
  if(ev.originalEvent.shiftKey){ waypoints.push([ev.latlng.lat, ev.latlng.lng]); redrawRoute(); }
});
document.getElementById('setStart').onclick=()=>{ const m=/(-?\d+\.\d+),\s*(-?\d+\.\d+)/.exec(document.getElementById('lastClick').textContent); if(m){ startPt=[parseFloat(m[1]),parseFloat(m[2])]; redrawRoute(); } };
document.getElementById('setEnd').onclick=()=>{ const m=/(-?\d+\.\d+),\s*(-?\d+\.\d+)/.exec(document.getElementById('lastClick').textContent); if(m){ endPt=[parseFloat(m[1]),parseFloat(m[2])]; redrawRoute(); } };
document.getElementById('clearRoute').onclick=()=>{ startPt=null; endPt=null; waypoints=[]; redrawRoute(); };

function redrawRoute(){
  if(routeLine){ routeLine.remove(); routeLine=null; }
  planMarks.forEach(m=> m.remove()); planMarks=[];
  const pts=[]; if(startPt) pts.push(startPt); pts.push(...waypoints); if(endPt) pts.push(endPt);
  if(pts.length>=2){ routeLine=L.polyline(pts,{color:'#22c55e'}).addTo(map); map.fitBounds(routeLine.getBounds(),{padding:[18,18]}); }
}

// ===== Distância e planeamento simples
function hav(a,b){ const R=6371; const toRad=x=> x*Math.PI/180;
  const dLat=toRad(b[0]-a[0]), dLon=toRad(b[1]-a[1]);
  const s=Math.sin(dLat/2)**2 + Math.cos(toRad(a[0]))*Math.cos(toRad(b[0]))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(s)));
}
function polyDist(points){ let d=0; for(let i=1;i<points.length;i++) d+=hav(points[i-1],points[i]); return d; }
function pointAtKm(points, km){ let r=km; for(let i=1;i<points.length;i++){ const seg=hav(points[i-1],points[i]); if(r<=seg){ const t=r/seg; return [points[i-1][0]+(points[i][0]-points[i-1][0])*t, points[i-1][1]+(points[i][1]-points[i-1][1])*t]; } r-=seg; } return points[points.length-1]; }
function nearestRest(lat,lon,list,maxKm){ let best=null, bd=1e9; for(const r of list){ const d=hav([lat,lon],[r.lat,r.lon]); if(d<bd){ bd=d; best=r; } } if(best && bd<=maxKm) return {...best, dist:bd}; return null; }

// Carrega base local de áreas
let RESTS=[];
fetch('assets/rest_areas.json').then(r=>r.json()).then(list=>{
  RESTS=list;
  const tb=document.querySelector('#restTable tbody'); tb.innerHTML='';
  list.forEach(r=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td>${r.name}</td><td>${r.lat.toFixed(4)}</td><td>${r.lon.toFixed(4)}</td>`; tb.appendChild(tr); });
});

// Planeador
function planRoute(points, avgKmH, startDate, prefer5km){
  const out=[]; if(points.length<2) return {plan:out,totalKm:0,totalDriveMs:0,breaks:0,rests:0};
  const totalKm=polyDist(points), msPerKm=3600000/Math.max(40,Math.min(100,avgKmH));
  let t=new Date(startDate).getTime(), driveDay=0, cont=0, doneKm=0, breaks=0, rests=0;

  while(doneKm<totalKm){
    const remainCont = Math.max(0, RULES.CONT_MS - cont);
    const remainDay  = Math.max(0, RULES.DAY9 - driveDay); // simples (sem 10h)
    if(remainDay<=0){ out.push({type:'REST', at:new Date(t).toLocaleString(), note:'Descanso diário ≥11h'}); t+=RULES.REST11; rests++; driveDay=0; cont=0; continue; }

    const driveMs = Math.min(remainCont, remainDay);
    const availKm = driveMs / msPerKm;
    const leftKm  = totalKm - doneKm;
    const thisKm  = Math.min(leftKm, availKm);
    const thisMs  = thisKm * msPerKm;

    out.push({type:'DRIVING', at:new Date(t).toLocaleString(), note:'Condução '+fmtH(thisMs)});
    t+=thisMs; doneKm+=thisKm; driveDay+=thisMs; cont+=thisMs;
    if(doneKm>=totalKm) break;

    if(cont>=RULES.CONT_MS){
      const target=pointAtKm(points, doneKm);
      const stop = RESTS.length ? (nearestRest(target[0],target[1],RESTS, prefer5km?5:10) || nearestRest(target[0],target[1],RESTS, 1e9)) : null;
      const link = stop? ` <a href="https://maps.google.com/?q=${stop.lat},${stop.lon}" target="_blank">Maps</a>` : '';
      const note = stop? `Pausa 45min em: ${stop.name} (${stop.dist?stop.dist.toFixed(1):'?'} km).${link}` : 'Pausa 45min.';
      out.push({type:'BREAK', at:new Date(t).toLocaleString(), note}); t+=RULES.BREAK_MS; breaks++; cont=0;
    }
  }
  return {plan:out,totalKm,totalDriveMs:totalKm*msPerKm,breaks,rests};
}

function renderPlan(res){
  const wrap=document.getElementById('plan'); wrap.innerHTML='';
  planMarks.forEach(m=> m.remove()); planMarks=[];
  const tbl=document.createElement('table');
  tbl.innerHTML='<thead><tr><th>Quando</th><th>Ação</th><th>Detalhe</th></tr></thead>';
  const tb=document.createElement('tbody');
  (res.plan||[]).forEach(s=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td>${s.at}</td><td>${s.type}</td><td>${s.note||''}</td>`; tb.appendChild(tr); });
  tbl.appendChild(tb); wrap.appendChild(tbl); window.__lastPlan = res;
}

// UI
(function initStartTime(){ const el=document.getElementById('startTime'); const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); el.value=d.toISOString().slice(0,16); })();
document.getElementById('btnPlan').onclick=()=>{
  const avg=parseFloat(document.getElementById('avgSpeed').value)||75;
  const startVal=document.getElementById('startTime').value;
  const prefer5km=document.getElementById('snapRest').checked;
  const pts=[]; if(startPt) pts.push(startPt); pts.push(...waypoints); if(endPt) pts.push(endPt);
  if(pts.length<2){ alert('Defina Início e Fim.'); return; }
  const res=planRoute(pts, avg, startVal? new Date(startVal): now(), prefer5km);
  renderPlan(res);
};
document.getElementById('btnPlanCSV').onclick=()=>{
  const res=window.__lastPlan; if(!res){ alert('Calcule o plano primeiro.'); return; }
  const rows=[['when','type','detail']].concat((res.plan||[]).map(s=>[s.at,s.type,(s.note||'').replaceAll('"','""')]));
  const csv=rows.map(r=> r.map(v=>`"${String(v)}"`).join(',')).join('\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  const a=document.createElement('a'); a.href=url; a.download='tacogrid_plano.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
};
document.getElementById('btnPlanPDF').onclick=()=>{
  const res=window.__lastPlan; if(!res){ alert('Calcule o plano primeiro.'); return; }
  const { jsPDF } = window.jspdf; const doc=new jsPDF({unit:'pt',format:'a4'}); const margin=40; let y=margin;
  doc.setFontSize(16); doc.text('Tacogrid — Plano de Rota', margin, y); y+=22;
  doc.setFontSize(10); doc.text('Gerado em: '+new Date().toLocaleString(), margin, y); y+=18;
  doc.setFontSize(12); doc.text('Distância total: '+res.totalKm.toFixed(1)+' km', margin, y); y+=14;
  doc.text('Tempo de condução: '+fmtH(res.totalDriveMs), margin, y); y+=14;
  doc.text('Pausas (45m): '+res.breaks+'  •  Descansos: '+res.rests, margin, y); y+=20;
  const head=['Quando','Ação','Detalhe'], colW=[130,80,320]; let x=margin; doc.setFont(undefined,'bold');
  for(let i=0;i<head.length;i++){ doc.text(head[i], x, y); x+=colW[i]; } doc.setFont(undefined,'normal'); y+=14;
  (res.plan||[]).forEach(s=>{ x=margin; doc.text(s.at, x, y); x+=colW[0]; doc.text(s.type, x, y); x+=colW[1]; const lines=doc.splitTextToSize(s.note||'', colW[2]); doc.text(lines, x, y); y+=14*lines.length; if(y>760){ doc.addPage(); y=margin; } });
  const pages=doc.getNumberOfPages(); for(let p=1;p<=pages;p++){ doc.setPage(p); doc.setFontSize(9); doc.text('© Tacogrid', margin, 820); doc.text('Página '+p+'/'+pages, 520, 820); }
  doc.save('tacogrid_plano.pdf');
};
