export function createCharts(options = {}) {	
  // options: { lineCanvas, histCanvas, pieCanvas, intervalMs }

	const rootStyles = getComputedStyle(document.documentElement);

	const CHANNEL_COLORS = [
	  rootStyles.getPropertyValue('--graph-1').trim(),
	  rootStyles.getPropertyValue('--graph-2').trim(),
	  rootStyles.getPropertyValue('--graph-3').trim()
	];

  const LINE_HISTORY_LEN = 28;
  const intervalMs = options.intervalMs ?? 80;

  // DOM elements (accept either element or id string)
  const g1 = resolveEl(options.lineCanvas, 'lineGraph');
  const hist = resolveEl(options.histCanvas, 'histGraph');
  const pie = resolveEl(options.pieCanvas, 'pieGraph');

  const g1ctx = g1.getContext('2d');
  const hctx  = hist.getContext('2d');
  const pct   = pie.getContext('2d');

  const g1w = g1.width, g1h = g1.height;
  const hw  = hist.width, hh  = hist.height;
  const pw  = pie.width,  ph  = pie.height;

  // state
  let smoothMode = false, chaosMode = false;
  let effectTimer = null;
  let intervalId = null;

  // data
  let histData = Array.from({length:8}, ()=>[Math.random(), Math.random(), Math.random()]);
  let lines = [Array(LINE_HISTORY_LEN).fill(0), Array(LINE_HISTORY_LEN).fill(0), Array(LINE_HISTORY_LEN).fill(0)];
  let pieVals = [0.33,0.33,0.34];

  /* ---------- Mode control API ---------- */
  function triggerSmoothMode(){
    smoothMode = true; chaosMode = false;
    resetEffectTimer();
  }
  function triggerChaosMode(){
    chaosMode = true; smoothMode = false;
    resetEffectTimer();
  }
  function resetEffectTimer(){
    if(effectTimer) clearTimeout(effectTimer);
    effectTimer = setTimeout(()=>{ smoothMode=false; chaosMode=false; }, 10000);
  }

  /* ---------- Data update ---------- */
  function updateUnifiedData(){
    const baseStep = 0.2;
    let deltas = [0,0,0];

    if(smoothMode){
      deltas = [0.1, -0.1, -0.1];
    } else if(chaosMode){
      deltas = [-0.1, 0.1, 0.1];
    }

    histData = histData.map(row=>{
      return row.map((v,i)=>{
        const delta = (Math.random() - (0.5 - deltas[i])) * baseStep;
        return Math.max(0.01, Math.min(0.99, v + delta));
      });
    });

    histData.forEach(row => row.histScale = chaosMode ? 1.2 : 1.0);

    for(let ch=0; ch<3; ch++){
      lines[ch].shift();
      lines[ch].push(histData.reduce((sum,row)=>sum+row[ch],0)/histData.length);
    }

    const totals = histData.reduce((acc,row)=>{
      acc[0]+=row[0]; acc[1]+=row[1]; acc[2]+=row[2];
      return acc;
    }, [0,0,0]);
    const sumTotals = (totals.reduce((a,b)=>a+b,0) || 1);
    pieVals = totals.map(v => v / sumTotals);
  }

  /* ---------- Draw functions ---------- */
  function stepHistogram(){
    hctx.clearRect(0,0,hw,hh);
    const bw = hw / histData.length;
    const maxTotal = Math.max(0.0001, ...histData.map(bin=>bin.reduce((a,b)=>a+b,0)));

    histData.forEach((vals,i)=>{
      let yBase = hh - 4, x = i*bw + 4;
      const scale = vals.histScale || 1;
      vals.forEach((v,j)=>{
        const barH = (v/maxTotal) * (hh - 8) * scale;
        hctx.fillStyle = CHANNEL_COLORS[j];
        hctx.fillRect(x, yBase - barH, bw - 6, barH);
        yBase -= barH;
      });
      hctx.fillStyle = 'rgba(0,0,0,0.12)';
      hctx.fillRect(x + bw - 7, 4, 1, hh - 8);
    });
  }

  function stepLines(){
    g1ctx.clearRect(0,0,g1w,g1h);
    const len = lines[0].length, pxStep = g1w / (len - 1);
    for(let s=0;s<3;s++){
      const arr = lines[s];
      g1ctx.beginPath();
      arr.forEach((v,i)=>{
        const x = i * pxStep, y = 4 + (1 - v) * (g1h - 8);
        i===0 ? g1ctx.moveTo(x,y) : g1ctx.lineTo(x,y);
      });
      g1ctx.lineWidth = 2;
      g1ctx.strokeStyle = CHANNEL_COLORS[s];
      g1ctx.stroke();

      g1ctx.lineTo((len-1)*pxStep, g1h-4);
      g1ctx.lineTo(0, g1h-4);
      g1ctx.closePath();
      g1ctx.fillStyle = CHANNEL_COLORS[s] + '22';
      g1ctx.fill();
    }
  }

  function stepPie(){
    const total = pieVals.reduce((a,b)=>a+b,0) || 1;
    pct.clearRect(0,0,pw,ph);
    const cx = pw/2, cy = ph/2, r = Math.min(pw,ph)/2 - 10;

    const blueAngle = pieVals[2] * 2 * Math.PI;
    const remaining = 2 * Math.PI - blueAngle;
    const redAngle = remaining * (pieVals[0] / (pieVals[0] + pieVals[1] || 1));
    const greenAngle = remaining - redAngle;

    const blueStart = -Math.PI/2 - blueAngle/2, blueEnd = blueStart + blueAngle;
    const redStart = blueEnd, redEnd = redStart + redAngle;
    const greenStart = redEnd, greenEnd = greenStart + greenAngle;

    pct.beginPath(); pct.moveTo(cx,cy); pct.arc(cx,cy,r,blueStart,blueEnd); pct.closePath(); pct.fillStyle=CHANNEL_COLORS[2]; pct.fill();
    pct.beginPath(); pct.moveTo(cx,cy); pct.arc(cx,cy,r,redStart,redEnd); pct.closePath(); pct.fillStyle=CHANNEL_COLORS[0]; pct.fill();
    pct.beginPath(); pct.moveTo(cx,cy); pct.arc(cx,cy,r,greenStart,greenEnd); pct.closePath(); pct.fillStyle=CHANNEL_COLORS[1]; pct.fill();
    pct.beginPath(); pct.arc(cx,cy,r*0.5,0,2*Math.PI); pct.fillStyle='rgba(0,0,0,0.12)'; pct.fill();
  }

  /* ---------- Master Step ---------- */
  function stepAllVisuals(){
    updateUnifiedData();
    stepHistogram();
    stepLines();
    stepPie();
  }

  /* ---------- Public API: start/stop/triggers ---------- */
  function start(){
    if(intervalId) return;
    intervalId = setInterval(stepAllVisuals, intervalMs);
    stepAllVisuals();
  }
  function stop(){
    if(intervalId){ clearInterval(intervalId); intervalId = null; }
  }

  // convenience resolver for elements
  function resolveEl(elOrId, defaultId){
    if(!elOrId) elOrId = defaultId;
    if(typeof elOrId === 'string') {
      const found = document.getElementById(elOrId);
      if(!found) throw new Error('Element not found: ' + elOrId);
      return found;
    }
    return elOrId;
  }

  // expose API
  return {
    start, stop,
    triggerSmoothMode, triggerChaosMode, resetEffectTimer,
    // allow external mutation/read of internals if needed
    getState(){ return { smoothMode, chaosMode }; },
    getData(){ return { histData: JSON.parse(JSON.stringify(histData)), lines: lines.map(a=>a.slice()), pieVals: pieVals.slice() } }
  };
}