// IDEA-060: the shrub reference is a WATERMARKED stock image on black
// (PngTree). Per IDEA-053 rule 4 no pixel of it is used as colour evidence —
// this measures SHAPE only, and masks to green so the watermark's white
// diagonals and logos cannot join the subject.
import { chromium } from "playwright";
import fs from "node:fs";
const b64 = fs.readFileSync(".img2threejs/reference/props/shrub/shrub.png").toString("base64");
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<body style='margin:0'></body>");
const r = await page.evaluate(async (b64) => {
  const im = new Image(); im.src = "data:image/png;base64," + b64; await im.decode();
  const W = im.naturalWidth, H = im.naturalHeight;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(im, 0, 0);
  const d = g.getImageData(0, 0, W, H).data;
  const green = (x, y) => { const i = (y*W+x)*4; return d[i+1] > d[i]+18 && d[i+1] > d[i+2]+18 && d[i+1] > 40; };
  let minX=W,minY=H,maxX=-1,maxY=-1,n=0;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){ if(!green(x,y))continue; n++;
    if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; }
  const bw=maxX-minX+1, bh=maxY-minY+1;
  const bands=[];
  for(let i=0;i<16;i++){
    const y=Math.min(maxY,minY+Math.round(((i+0.5)/16)*bh));
    let lo=-1,hi=-1,cnt=0;
    for(let x=minX;x<=maxX;x++){ if(!green(x,y))continue; cnt++; if(lo<0)lo=x; hi=x; }
    bands.push({y:+((i+0.5)/16).toFixed(3), span: lo<0?0:+((hi-lo+1)/bw).toFixed(3), fill:+(cnt/bw).toFixed(3)});
  }
  // Silhouette roughness: how far the outline wanders as a fraction of the
  // radius. This is the number that separates "a ball of leaves" from "a
  // sphere" — the whole reason the shipped shrub is not three spheres.
  const cx=(minX+maxX)/2, cy=(minY+maxY)/2;
  const radii=[];
  for(let a=0;a<360;a+=2){
    const t=a*Math.PI/180; let last=0;
    for(let rr=4;rr<Math.max(bw,bh);rr+=2){
      const x=Math.round(cx+Math.cos(t)*rr), y=Math.round(cy+Math.sin(t)*rr);
      if(x<0||y<0||x>=W||y>=H)break;
      if(green(x,y)) last=rr;
    }
    radii.push(last);
  }
  const mean=radii.reduce((a,b)=>a+b,0)/radii.length;
  const sd=Math.sqrt(radii.reduce((a,b)=>a+(b-mean)**2,0)/radii.length);
  return { bbox:{w:bw,h:bh,widthOverHeight:+(bw/bh).toFixed(3)}, coverage:+(n/(bw*bh)).toFixed(3),
           bands, silhouette:{ meanRadius:Math.round(mean), sd:Math.round(sd), roughness:+(sd/mean).toFixed(3),
           min:Math.min(...radii), max:Math.max(...radii) } };
}, b64);
console.log(JSON.stringify(r,null,1));
await browser.close();
