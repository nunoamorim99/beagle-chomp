// IDEA-060: measure .img2threejs/reference/boardwalls/shrubfence.jpg.
import { chromium } from "playwright";
import fs from "node:fs";
const img = ".img2threejs/reference/boardwalls/shrubfence.jpg";
const b64 = fs.readFileSync(img).toString("base64");
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<body style='margin:0'></body>");
const res = await page.evaluate(async ({ b64 }) => {
  const im = new Image(); im.src = "data:image/jpeg;base64," + b64; await im.decode();
  const W = im.naturalWidth, H = im.naturalHeight;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(im, 0, 0);
  const d = g.getImageData(0, 0, W, H).data;
  const at = (x,y)=>{const i=(y*W+x)*4; return [d[i],d[i+1],d[i+2]];};
  const out = { W, H, samples: {} };
  // Raw colour samples at named probes so the fence's real value is known
  // rather than assumed (the background is white and so is the fence).
  const probes = { bgTopLeft:[10,10], bgBotRight:[1370,540],
    fenceMid:[200,400], fenceMid2:[700,400], fenceLow:[300,450],
    hedgeDark:[400,300], hedgeMid:[600,200], hedgeLight:[500,150], hedgeTop:[300,120] };
  for (const [k,[x,y]] of Object.entries(probes)) out.samples[k] = at(x,y);
  // Column profile: topmost non-background pixel per column (hedge crown), and
  // the y where the column stops being green (hedge->fence handover).
  const bg = (r,gg,b)=> r>247&&gg>247&&b>247;
  const green = (r,gg,b)=> gg>r+12 && gg>b+12;
  const tops=[], greenBots=[], bots=[];
  for(let x=0;x<W;x++){
    let top=-1, gb=-1, bot=-1;
    for(let y=0;y<H;y++){ const[r,gg,b]=at(x,y); if(!bg(r,gg,b)){ if(top<0)top=y; bot=y; if(green(r,gg,b)) gb=y; } }
    tops.push(top); greenBots.push(gb); bots.push(bot);
  }
  const valid = tops.map((t,i)=>({t,gb:greenBots[i],b:bots[i]})).filter(v=>v.t>=0);
  const med = a => { const s=[...a].sort((p,q)=>p-q); return s[Math.floor(s.length/2)]; };
  out.crown = { minTop: Math.min(...valid.map(v=>v.t)), medTop: med(valid.map(v=>v.t)), maxTop: Math.max(...valid.map(v=>v.t)) };
  out.greenBottom = { med: med(valid.map(v=>v.gb)), max: Math.max(...valid.map(v=>v.gb)) };
  out.bottom = { med: med(valid.map(v=>v.b)), max: Math.max(...valid.map(v=>v.b)) };
  out.subjectX = { min: tops.findIndex(t=>t>=0), max: W-1-[...tops].reverse().findIndex(t=>t>=0) };
  // Picket pitch: at a row inside the fence, the PICKET is lighter than the
  // GAP (which shows dark hedge behind). Count transitions on luma.
  const rowAt = (y) => { const lum=[]; for(let x=0;x<W;x++){const[r,gg,b]=at(x,y); lum.push(0.299*r+0.587*gg+0.114*b);} return lum; };
  for (const y of [380, 400, 430]) {
    const lum = rowAt(y);
    const x0 = out.subjectX.min+4, x1 = out.subjectX.max-4;
    const seg = lum.slice(x0, x1+1);
    const mid = (Math.max(...seg)+Math.min(...seg))/2;
    const runs=[]; let inRun=false,start=0;
    for(let i=0;i<seg.length;i++){ const hi = seg[i]>mid;
      if(hi&&!inRun){inRun=true;start=i;} else if(!hi&&inRun){inRun=false;runs.push([start+x0, i-start]);} }
    if(inRun) runs.push([start+x0, seg.length-start]);
    const starts = runs.map(r=>r[0]); const pitches=[];
    for(let i=1;i<starts.length;i++) pitches.push(starts[i]-starts[i-1]);
    out[`row${y}`] = { threshold:+mid.toFixed(1), pickets: runs.length,
      medWidth: med(runs.map(r=>r[1])), medPitch: pitches.length?med(pitches):null,
      widths: runs.map(r=>r[1]).slice(0,10), pitches: pitches.slice(0,10) };
  }
  // Flower (white daisy) count + size inside the hedge band.
  const seen = new Uint8Array(W*H); const blobs=[];
  const isFlower=(x,y)=>{const[r,gg,b]=at(x,y); return r>225&&gg>222&&b>215&&Math.max(r,gg,b)-Math.min(r,gg,b)<28;};
  const yTop = out.crown.minTop, yBot = out.greenBottom.med;
  for(let y=yTop;y<yBot;y++)for(let x=out.subjectX.min;x<=out.subjectX.max;x++){
    if(seen[y*W+x]||!isFlower(x,y))continue;
    let n=0,mnx=x,mxx=x,mny=y,mxy=y; const st=[[x,y]]; seen[y*W+x]=1;
    while(st.length){ const[cx,cy]=st.pop(); n++;
      if(cx<mnx)mnx=cx; if(cx>mxx)mxx=cx; if(cy<mny)mny=cy; if(cy>mxy)mxy=cy;
      for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const nx=cx+dx,ny=cy+dy;
        if(nx<0||ny<0||nx>=W||ny>=H||seen[ny*W+nx]||!isFlower(nx,ny))continue; seen[ny*W+nx]=1; st.push([nx,ny]);}}
    if(n>=12) blobs.push({n, w:mxx-mnx+1, h:mxy-mny+1});
  }
  out.flowers = { count: blobs.length, medW: med(blobs.map(b=>b.w)), medH: med(blobs.map(b=>b.h)),
    maxW: Math.max(...blobs.map(b=>b.w)) };
  return out;
}, { b64 });
console.log(JSON.stringify(res,null,1));
await browser.close();
