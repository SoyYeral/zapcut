var cep = window.__adobe_cep__;
var fs = require("fs"), path = require("path"), os = require("os"), cp = require("child_process");
var $ = function(i){ return document.getElementById(i); };
var all = function(s){ return Array.prototype.slice.call(document.querySelectorAll(s)); };

var DEFAULT_WORDS = ["mierda*","coño*","carajo*","puta*","puto*","joder","jodid*","pendejo*","pendeja*","cabron*","cabrón*","verga","culo","marico*","maricon*","mamaguevo*","guevo*","hijueputa","hijoeputa","chingar","chinga*","cojon*","maldit*","gilipollas","zorra*","bastardo*","pariguayo*"];
var extDir = decodeURI(cep.getSystemPath("extension")).replace(/^file:\/\/\//,"");
var dataDir = path.join(process.env.LOCALAPPDATA || os.homedir(), "ZapCut");
var pyExe = path.join(dataDir, "venv", "Scripts", "python.exe");
var engine = path.join(extDir, "engine", "engine.py");
var info = null, busy = false, timer = null, t0 = 0;

function log(m){ $("log").textContent += m + "\n"; $("log").scrollTop = 1e9; }
function status(m){ $("status").textContent = m; }
var PR = {a: 0, b: 1};
function prog(p){ p = PR.a + Math.min(Math.max(p,0),1) * (PR.b - PR.a); var v = Math.round(p*100) + "%"; $("fill").style.width = v; $("pct").textContent = v; }
function jsx(code){ return new Promise(function(res){ cep.evalScript(code, res); }); }
function qs(s){ return String(s).replace(/\\/g,"\\\\").replace(/'/g,"\\'"); }
function norm(w){ return w.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-zñ]/g,""); }
function fmtT(ms){ var s = Math.floor(ms/1000); return Math.floor(s/60) + ":" + ("0"+(s%60)).slice(-2); }
function startTimer(){ t0 = Date.now(); $("n2").textContent = "0:00"; timer = setInterval(function(){ $("n2").textContent = fmtT(Date.now()-t0); }, 500); }
function stopTimer(){ clearInterval(timer); $("n2").textContent = fmtT(Date.now()-t0); }
function ease(u){ u = Math.min(Math.max(u,0),1); return u*u*(3-2*u); }

/* ---------- UI: tabs, segmented controls, sliders ---------- */
all(".tab").forEach(function(b){ b.onclick = function(){
  all(".tab").forEach(function(x){ x.className = "tab"; }); b.className = "tab on";
  ["clean","reframe","viral","multi"].forEach(function(id){ $(id).hidden = id !== b.getAttribute("data-t"); });
  if(b.getAttribute("data-t") === "multi" && typeof mcLoad === "function") mcLoad();
}; });
function segment(boxId, hiddenId, cb){
  all("#"+boxId+" button").forEach(function(b){ b.onclick = function(){
    all("#"+boxId+" button").forEach(function(x){ x.className = ""; }); b.className = "on";
    $(hiddenId).value = b.getAttribute("data-v"); if(cb) cb();
  }; });
}
function bindSlider(id, out, fmt){ var f = function(){ $(out).textContent = fmt($(id).value); }; $(id).oninput = f; f(); }
bindSlider("th","thv",function(v){ return v + " dB"; });
bindSlider("md","mdv",function(v){ return (v/100).toFixed(2) + " s"; });
bindSlider("pd","pdv",function(v){ return (v*10) + " ms"; });
bindSlider("zmax","zmaxv",function(v){ return v + "%"; });
$("auto").onchange = function(){ $("th").disabled = $("auto").checked; }; $("th").disabled = true;
segment("seg","model");

var ZHINT = {off:"El encuadre queda fijo, sin acercamientos.", fixed:"Acercamiento constante durante todo el clip.", "in":"Se acerca poco a poco desde 100% hasta la intensidad elegida.", out:"Empieza cerca y se aleja hasta 100%.", dyn:"Alterna acercamientos y alejamientos con ritmo, como en shorts."};
function zoomUi(){ var m = $("zmv").value; $("zrow").hidden = m === "off"; $("zhint").textContent = ZHINT[m]; }
segment("zmode","zmv", zoomUi); zoomUi();
var FORMATS = {"9x16":[1080,1920], "4x5":[1080,1350], "3x4":[1080,1440], "1x1":[1080,1080], "16x9":[1920,1080]};
var RHINT = {auto:"Habla una persona: el encuadre la sigue. Hablan dos o más a la vez: pantalla dividida, una arriba y otra abajo.", single:"Sigue siempre a la persona que está hablando.", split:"Pantalla dividida fija durante todo el clip cuando hay dos personas."};
function canSplitFmt(){ var f = FORMATS[$("fmv").value]; return f[1] >= f[0] * 1.24; }
function reframeUi(){
  var m = $("rmv").value, split = m === "split";
  $("zoomCard").hidden = split; $("swapRow").hidden = m === "single" || !canSplitFmt();
  $("rhint").textContent = RHINT[m] + (canSplitFmt() ? "" : " (Este formato es muy ancho: se usa un solo encuadre.)");
}
var THINT = {follow:"El encuadre se mueve para mantener a la persona en el centro.", fixed:"El encuadre no se mueve: queda fijo en la posición de cada persona."};
function trackUi(){ $("thint").textContent = THINT[$("tmv").value]; }
segment("tmode","tmv", trackUi); trackUi();
segment("rmode","rmv", reframeUi);
segment("fmt","fmv", reframeUi); reframeUi();


/* ---------- Lista de palabras con casillas ---------- */
var WL = [];
function loadWL(){
  try{ var s = JSON.parse(localStorage.getItem("zc_wl")); if(s && s.length) return s; }catch(e){}
  return DEFAULT_WORDS.map(function(w){ return {w: w, on: true}; });
}
function saveWL(){ try{ localStorage.setItem("zc_wl", JSON.stringify(WL)); }catch(e){} }
function renderWL(){
  var on = WL.filter(function(x){ return x.on; }).length;
  $("wsum").textContent = "Palabras a silenciar (" + on + " activas de " + WL.length + ")";
  $("wl").innerHTML = WL.map(function(x, i){
    return '<label class="wrow' + (x.on ? "" : " off") + '"><input type="checkbox" data-i="' + i + '"' + (x.on ? " checked" : "") + '><span>' + x.w.replace(/</g,"&lt;") + '</span><button data-del="' + i + '" title="Quitar">×</button></label>';
  }).join("");
}
$("wl").onclick = function(e){
  var d = e.target.getAttribute && e.target.getAttribute("data-del");
  if(d !== null && d !== undefined){ e.preventDefault(); WL.splice(parseInt(d,10), 1); saveWL(); renderWL(); return; }
  var i = e.target.getAttribute && e.target.getAttribute("data-i");
  if(i !== null && i !== undefined){ WL[parseInt(i,10)].on = e.target.checked; saveWL(); renderWL(); }
};
function addWord(){
  var v = $("wnew").value.trim().toLowerCase(); if(!v) return;
  if(!WL.some(function(x){ return x.w === v; })) WL.unshift({w: v, on: true});
  $("wnew").value = ""; saveWL(); renderWL();
}
$("wadd").onclick = addWord; $("wnew").onkeydown = function(e){ if(e.keyCode === 13) addWord(); };
$("wreset").onclick = function(){ WL = DEFAULT_WORDS.map(function(w){ return {w: w, on: true}; }); saveWL(); renderWL(); };
WL = loadWL(); renderWL();
function buildMatcher(){
  var exact = {}, stems = [];
  WL.forEach(function(x){ if(!x.on) return; var l = x.w.trim(); if(!l) return; if(l.slice(-1)==="*") stems.push(norm(l)); else exact[norm(l)] = 1; });
  return function(w){ var n = norm(w); if(!n) return false; if(exact[n]) return true; for(var i=0;i<stems.length;i++) if(n.indexOf(stems[i])===0) return true; return false; };
}

/* ---------- Premiere: info y selección ---------- */
function parse(s){ try{ return JSON.parse(s); }catch(e){ throw new Error("Premiere no respondió: " + String(s).slice(0,120)); } }
async function getInfo(){
  var r = parse(await jsx("getInfo()"));
  if(r.error) throw new Error(r.error);
  info = r; return r;
}
function fillTracks(){
  var seen = {}, vo = '<option value="all">Todas las seleccionadas</option>';
  info.a.forEach(function(c){ if(!seen[c.t]){ seen[c.t] = 1; vo += '<option value="' + c.t + '">Solo A' + (c.t+1) + '</option>'; } });
  var cur = $("voice").value; $("voice").innerHTML = vo; $("voice").value = seen[cur] ? cur : "all";
}
function selAudio(){
  var a = info.a.filter(function(c){ return c.sel; });
  if(!a.length){
    info.v.filter(function(c){ return c.sel; }).forEach(function(vc){
      info.a.forEach(function(ac){ if(ac.path === vc.path && Math.abs(ac.s - vc.s) < 0.05 && Math.abs(ac.e - vc.e) < 0.05) a.push(ac); });
    });
  }
  var vt = $("voice").value;
  return a.filter(function(c){ return vt === "all" || String(c.t) === vt; });
}
function selVideo(){ return info.v.filter(function(c){ return c.sel; }); }
var NOSEL = "Selecciona primero uno o más clips en la secuencia.";

setInterval(async function(){
  if(busy) return;
  try{
    var n = parseInt(await jsx("getSelCount()"), 10) || 0, c = $("selchip");
    c.textContent = n ? "● " + n + (n === 1 ? " clip seleccionado" : " clips seleccionados") : "Selecciona clips en la secuencia";
    c.className = n ? "chip ok" : "chip";
  }catch(e){}
}, 1500);

/* ---------- Motor Python ---------- */
function engineReady(){ return fs.existsSync(pyExe) && fs.existsSync(path.join(dataDir, ".ready_v3")); }
var setupP = null;
function ensureEngine(){
  if(engineReady()) return Promise.resolve();
  if(setupP) return setupP;
  setupP = new Promise(function(res, rej){
    status("Instalando el motor de análisis (solo la primera vez, puede tardar varios minutos)…");
    var p = cp.spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(extDir, "engine", "setup.ps1")], {windowsHide: true});
    p.stdout.on("data", function(d){ var l = String(d).trim().split(/\r?\n/).pop(); if(l) log(l.slice(0, 120)); });
    p.on("error", function(){ setupP = null; rej(new Error("No se pudo iniciar la instalación del motor.")); });
    p.on("close", function(){ setupP = null; if(engineReady()) res(); else rej(new Error("No se pudo instalar el motor. Revisa tu internet y vuelve a intentar.")); });
  });
  return setupP;
}
function runEngine(cmd, params, jobs, onProg){ return ensureEngine().then(function(){ return runEngine0(cmd, params, jobs, onProg); }); }
function runEngine0(cmd, params, jobs, onProg){
  return new Promise(function(resolve, reject){
    if(!fs.existsSync(pyExe)) return reject(new Error("Falta el motor. Reinstala ZapCut con internet."));
    var jf = path.join(os.tmpdir(), "zapcut_" + cmd + "_" + Date.now() + ".json");
    fs.writeFileSync(jf, JSON.stringify({params: params, jobs: jobs}), "utf8");
    var p = cp.spawn(pyExe, [engine, cmd, jf], {windowsHide: true}), out = "", err = "";
    p.stdout.on("data", function(d){ out += d; });
    p.stderr.on("data", function(d){ String(d).split(/\r?\n/).forEach(function(l){
      var m = /^PROGRESS ([\d.]+)/.exec(l); if(m) onProg(parseFloat(m[1])); else if(l.trim()) err += l + "\n"; }); });
    p.on("error", function(){ reject(new Error("No se pudo iniciar el motor. Reinstala ZapCut.")); });
    p.on("close", function(code){
      try{ fs.unlinkSync(jf); }catch(e){}
      if(code !== 0) return reject(new Error(err.slice(-300) || "Error del motor"));
      try{ resolve(JSON.parse(out.trim().split(/\r?\n/).pop())); }catch(e){ reject(e); }
    });
  });
}
function mergeJobs(clips){
  var by = {}, jobs = [];
  clips.forEach(function(c){ (by[c.path] = by[c.path] || []).push([c.inP, c.outP]); });
  Object.keys(by).forEach(function(p){
    var r = by[p].sort(function(a,b){ return a[0]-b[0]; }), cur = r[0].slice();
    for(var i=1;i<r.length;i++){
      if(r[i][0] - cur[1] < 3) cur[1] = Math.max(cur[1], r[i][1]);
      else { jobs.push({id: jobs.length, path: p, start: cur[0], end: cur[1]}); cur = r[i].slice(); }
    }
    jobs.push({id: jobs.length, path: p, start: cur[0], end: cur[1]});
  });
  return jobs;
}
function wordsOf(c, jobs, res){
  var j = jobs.filter(function(x){ return x.path === c.path && x.start <= c.inP + 0.01 && x.end >= c.outP - 0.01; })[0];
  var w = j && res[j.id];
  if(!w || w.error){ log("Sin transcripción para " + c.name + (w ? ": " + w.error : "")); return []; }
  return w.filter(function(x){ return x[2] > c.inP && x[1] < c.outP; });
}

/* ---------- Clean (Bleep + Silence) ---------- */
function mergeIv(a){
  a = a.slice().sort(function(x,y){ return x[0]-y[0]; });
  var m = [];
  a.forEach(function(r){ var l = m[m.length-1]; if(l && r[0] <= l[1] + 0.001) l[1] = Math.max(l[1], r[1]); else m.push(r.slice()); });
  return m;
}
function seqSilences(clips, results){
  var loud = [], cover = [];
  clips.forEach(function(c, i){
    cover.push([c.s, c.e]);
    var r = results[i];
    if(!r || r.error){ loud.push([c.s, c.e]); return; }
    var cur = c.s;
    r.silences.forEach(function(sl){
      var a = Math.max(c.s + (sl[0] - c.inP), c.s), b = Math.min(c.s + (sl[1] - c.inP), c.e);
      if(b <= a) return;
      if(a > cur) loud.push([cur, a]);
      cur = Math.max(cur, b);
    });
    if(cur < c.e) loud.push([cur, c.e]);
  });
  var L = mergeIv(loud), C = mergeIv(cover), gaps = [];
  C.forEach(function(cv){
    var pos = cv[0];
    L.forEach(function(r){
      if(r[1] <= cv[0] || r[0] >= cv[1]) return;
      var a = Math.max(r[0], cv[0]), b = Math.min(r[1], cv[1]);
      if(a - pos >= 0.06) gaps.push([pos, a]);
      pos = Math.max(pos, b);
    });
    if(cv[1] - pos >= 0.06) gaps.push([pos, cv[1]]);
  });
  return gaps;
}

async function runClean(){
  var wantW = $("tgWords").checked, wantS = $("tgSil").checked, wantSp = $("tgSp").checked;
  if(!wantW && !wantS && !wantSp) throw new Error("Activa Bleep, Silence o Habla limpia.");
  status("Leyendo la selección…"); await getInfo(); fillTracks();
  var clips = selAudio();
  if(!clips.length) throw new Error(NOSEL);
  return cleanCore(clips, wantW, wantS, wantSp);
}
async function cleanCore(clips, wantW, wantS, wantSp){
  log(clips.length + " clip(s) de audio seleccionados");
  var needT = wantW || wantSp;
  var pw = 0, ps = 0, ww = needT && wantS ? 0.85 : 1;
  function upd(){ prog((needT ? pw*ww : 0) + (wantS ? ps*(needT ? 1-ww : 1) : 0)); }
  status("Analizando audio…");
  var wjobs = needT ? mergeJobs(clips) : [];
  var sjobs = wantS ? clips.map(function(c, i){ return {id: i, path: c.path, start: c.inP, end: c.outP}; }) : [];
  var rr = await Promise.all([
    needT ? runEngine("transcribe", {model: $("model").value, lang: "es", disf: !!wantSp}, wjobs, function(p){ pw = p; upd(); }).then(function(r){ pw = 1; upd(); return r; }) : null,
    wantS ? runEngine("silence", {thresh: +$("th").value, auto: $("auto").checked, min_dur: $("md").value/100, pad: $("pd").value*10/1000}, sjobs, function(p){ ps = p; upd(); }).then(function(r){ ps = 1; upd(); return r; }) : null
  ]);
  var wres = rr[0], sres = rr[1], didW = 0, didS = 0, removed = 0;

  if(wantW){
    status("Silenciando malas palabras…");
    var isBad = buildMatcher(), items = [];
    clips.forEach(function(c){
      var mine = [];
      wordsOf(c, wjobs, wres).forEach(function(w){
        if(isBad(w[0])){
          var ms = Math.max(w[1], c.inP), me = Math.min(w[2], c.outP);
          mine.push({t: c.t, c: c.c, s: c.s + (ms - c.inP), e: c.s + (me - c.inP), ms: ms, me: me, w: w[0]});
        }
      });
      mine.sort(function(a,b){ return a.s - b.s; });
      var m2 = [];
      mine.forEach(function(r){ var l = m2[m2.length-1]; if(l && r.s - l.e < 0.12){ l.e = Math.max(l.e, r.e); l.me = Math.max(l.me, r.me); } else m2.push(r); });
      m2.forEach(function(r){ log("  bleep: " + r.w + " @ " + r.s.toFixed(1) + "s"); });
      items = items.concat(m2);
    });
    for(var i=0;i<items.length;i+=100){
      var spec = items.slice(i, i+100).map(function(r){ return [r.t, r.s.toFixed(3), r.e.toFixed(3), r.c, r.ms.toFixed(3), r.me.toFixed(3)].join(","); }).join("|");
      var res = String(await jsx("muteWords('" + spec + "')"));
      if(res.indexOf("ok:") !== 0) throw new Error("Premiere: " + res);
      didW += parseInt(res.split(":")[1], 10) || 0;
    }
  }

  var spCut = [], cnt = {rep: 0, fill: 0, brk: 0, rev: 0};
  if(wantSp){
    status("Buscando repeticiones y muletillas…");
    var spOpts = {rep: $("spRep").checked, broken: $("spFalse").checked, fill: $("spFill").checked, fillers: FL.items.filter(function(x){ return x.on; }).map(function(x){ return x.w; })};
    var found = [];
    clips.forEach(function(c){
      spCuts(wordsOf(c, wjobs, wres), spOpts).forEach(function(x){
        var a = Math.max(c.s + (x.a - c.inP), c.s), b = Math.min(c.s + (x.b - c.inP), c.e);
        if(b - a >= 0.05) found.push({a: a, b: b, type: x.type, text: x.text, review: x.review});
      });
    });
    found.sort(function(x, y){ return x.a - y.a; });
    var uniq = [];
    found.forEach(function(x){
      var l = uniq[uniq.length - 1];
      if(l && x.a < l.b - 0.5 * Math.min(l.b - l.a, x.b - x.a)) return;
      uniq.push(x);
    });
    uniq.forEach(function(x){
      if(x.review) cnt.rev++; else if(x.type === "Repetición") cnt.rep++; else if(x.type === "Muletilla") cnt.fill++; else cnt.brk++;
      log("  " + x.type.toLowerCase() + ": «" + x.text + "» @ " + x.a.toFixed(1) + "s" + (x.review ? " (revisar)" : ""));
    });
    var doCut = $("spAct").value === "cut";
    var toMark = uniq.filter(function(x){ return !doCut || x.review; });
    if(doCut) spCut = mergeIv(uniq.filter(function(x){ return !x.review; }).map(function(x){ return [x.a, x.b]; }));
    if(toMark.length){
      var COL = {"Repetición": 3, "Muletilla": 4, "Frase sin terminar": 1, "Revisar frase colgada": 5};
      var js = JSON.stringify(toMark.map(function(x){ return {s: x.a, e: x.b, name: x.type, note: x.text, color: COL[x.type] || 5}; }))
        .replace(/[\u007f-￿]/g, function(ch){ return "\\u" + ("0000" + ch.charCodeAt(0).toString(16)).slice(-4); });
      var mr = String(await jsx("addMarks('" + qs(js) + "')"));
      if(mr.indexOf("ok:") !== 0) throw new Error("Premiere: " + mr);
    }
  }

  var silGaps = [], mode = $("act").value, markSil = wantS && mode === "mark";
  if(wantS){
    if($("auto").checked && sres[0] && sres[0].thresh !== undefined) log("Umbral automático: " + sres[0].thresh + " dB");
    silGaps = seqSilences(clips, sres);
    var sl = 0; silGaps.forEach(function(g){ sl += g[1] - g[0]; });
    log(silGaps.length + " silencios (" + sl.toFixed(1) + " s)");
    didS = silGaps.length;
  }
  var cutList = markSil ? spCut : mergeIv(silGaps.concat(spCut));
  if(markSil && silGaps.length){
    for(var m = 0; m < silGaps.length; m += 20){
      var rs = String(await jsx("cutSilences('" + silGaps.slice(m, m + 20).map(function(g){ return g[0].toFixed(3) + "," + g[1].toFixed(3); }).join(";") + "','mark')"));
      if(rs.indexOf("ok:") !== 0) throw new Error("Premiere: " + rs);
    }
  }
  if(cutList.length){
    status("Cortando…");
    cutList.forEach(function(g){ removed += g[1] - g[0]; });
    var chunks = [];
    for(var k=0;k<cutList.length;k+=20) chunks.push(cutList.slice(k, k+20));
    for(var q=chunks.length-1;q>=0;q--){
      var sp = chunks[q].map(function(g){ return g[0].toFixed(3) + "," + g[1].toFixed(3); }).join(";");
      var r2 = String(await jsx("cutSilences('" + sp + "','cut')"));
      if(r2.indexOf("ok:") !== 0) throw new Error("Premiere: " + r2);
      status("Cortando… " + (chunks.length - q) + "/" + chunks.length);
    }
  }
  var parts = [];
  if(wantW) parts.push(didW + " palabra(s) silenciada(s)");
  if(wantS) parts.push(didS + " silencio(s)" + (markSil ? " marcado(s)" : ""));
  if(wantSp) parts.push(cnt.rep + " repetición(es), " + cnt.fill + " muletilla(s), " + cnt.brk + " frase(s) sin terminar" + (cnt.rev ? ", " + cnt.rev + " para revisar" : "") + ($("spAct").value === "mark" ? " (marcadas)" : ""));
  $("n1").textContent = didW + didS + cnt.rep + cnt.fill + cnt.brk; $("l1").textContent = "acciones";
  return "Listo: " + parts.join("; ") + (removed ? " · " + removed.toFixed(1) + " s quitados" : "") + ".";
}

/* ---------- Reframe ---------- */
function geom(srcW, srcH, seqW, seqH, targetH, basis){
  var f = Math.max(targetH / srcH, seqW / srcW), fit = Math.min(seqW / srcW, seqH / srcH);
  return {f: f, S: basis === "fit" ? f / fit * 100 : f * 100, sw: srcW * f, sh: srcH * f};
}
function xNorm(cx, g, seqW){ var c = Math.min(Math.max(cx * g.sw, seqW/2), g.sw - seqW/2); return (seqW/2 - (c - g.sw/2)) / seqW; }
function yNorm(cy, g, seqH){ var c = Math.min(Math.max(cy * g.sh, seqH/2), g.sh - seqH/2); return (seqH/2 - (c - g.sh/2)) / seqH; }
function median(a){ var s = a.slice().sort(function(x,y){ return x-y; }); return s.length ? s[Math.floor(s.length/2)] : 0.4; }

function dynZ(t, zmax){
  var d = [2.4, 2.8, 2.2, 3.2], acc = 0, i = 0, state = 0, prev = 1;
  while(acc + d[i % 4] <= t){ acc += d[i % 4]; prev = state ? zmax : 1; state ^= 1; i++; }
  var target = state ? zmax : 1, u = (t - acc) / 0.45;
  return (i > 0 && u < 1) ? prev + (target - prev) * ease(u) : target;
}
function zoomAt(mode, zmax, t, len){
  var u = len > 0 ? t / len : 0;
  if(mode === "fixed") return zmax;
  if(mode === "in") return 1 + (zmax - 1) * ease(u);
  if(mode === "out") return zmax - (zmax - 1) * ease(u);
  if(mode === "dyn") return dynZ(t, zmax);
  return 1;
}
function keyStr(t, x, y, S){ return t.toFixed(3) + "," + x.toFixed(4) + "," + y.toFixed(4) + "," + S.toFixed(2); }

function singleKeys(r, c, o){
  var times = (r.t && r.t.length) ? r.t : [], i, t;
  if(!times.length){ for(t = c.inP; t < c.outP; t += 0.25) times.push(t); times.push(c.outP); }
  var med = r.K ? median(r.cy[0]) : 0.4, keys = [], last = null, len = c.outP - c.inP;
  for(i=0;i<times.length;i++){
    var z = zoomAt(o.zmode, o.zmax, times[i] - c.inP, len);
    var g = geom(r.W, r.H, o.seqW, o.seqH, o.seqH * z, o.basis);
    var x = xNorm(r.K ? r.cx[r.act[i]][i] : 0.5, g, o.seqW), y = yNorm(med, g, o.seqH);
    if(r.K && last && i > 0 && r.act[i] !== r.act[i-1]){
      keys.push(keyStr(times[i] - 0.05, last.x, last.y, last.S)); keys.push(keyStr(times[i], x, y, g.S));
    } else if(!last || Math.abs(x - last.x) > 0.004 || Math.abs(y - last.y) > 0.004 || Math.abs(g.S - last.S) > 0.6 || i === times.length - 1){
      keys.push(keyStr(times[i], x, y, g.S));
    } else continue;
    last = {x: x, y: y, S: g.S};
  }
  return keys.join(";");
}
function splitKeys(r, slot, yFixed, g, seqW){
  var keys = [], lastX = null;
  for(var i=0;i<r.t.length;i++){
    var x = xNorm(r.cx[slot][i], g, seqW);
    if(lastX === null || Math.abs(x - lastX) > 0.004 || i === r.t.length - 1){ keys.push(keyStr(r.t[i], x, yFixed, g.S)); lastX = x; }
  }
  return keys.join(";");
}

/* Reframe dinámico: pantalla dividida solo mientras hablan 2+ personas, seguimiento cuando habla 1 */
function dynRuns(r, minLen){
  var n = r.t.length, st = [], i, k, prev = null, step = 0.2;
  for(i=0;i<n;i++){
    var on = [], key;
    for(k=0;k<r.K;k++) if(r.spk && r.spk[k] && r.spk[k][i]) on.push(k);
    if(on.length >= 2) key = "S" + on[0] + "," + on[1];
    else if(on.length === 1) key = "P" + on[0];
    else key = prev;
    st.push(key); if(key) prev = key;
  }
  var first = null;
  for(i=0;i<n;i++) if(st[i]){ first = st[i]; break; }
  if(!first) first = "P" + (r.act && r.act.length ? r.act[0] : 0);
  for(i=0;i<n && !st[i];i++) st[i] = first;
  var runs = [];
  for(i=0;i<n;i++){
    if(runs.length && runs[runs.length-1].key === st[i]) runs[runs.length-1].e = i;
    else runs.push({key: st[i], s: i, e: i});
  }
  var changed = true, q;
  while(changed && runs.length > 1){
    changed = false;
    for(q=0;q<runs.length;q++){
      if((runs[q].e - runs[q].s + 1) * step < minLen){
        if(q > 0) runs[q-1].e = runs[q].e; else runs[q+1].s = runs[q].s;
        runs.splice(q, 1); changed = true; break;
      }
    }
    for(q=runs.length-1;q>0;q--){
      if(runs[q].key === runs[q-1].key){ runs[q-1].e = runs[q].e; runs.splice(q, 1); }
    }
  }
  return runs;
}
function dynPlan(r, c, o){
  var runs = dynRuns(r, 1.2), gs = geom(r.W, r.H, o.seqW, o.seqH, o.seqH/2, o.basis), len = c.outP - c.inP;
  var B = {k: [], last: null}, T = {k: [], last: null}, OP = [], opLast = null, nSplit = 0, secSplit = 0, med = [], k;
  for(k=0;k<r.K;k++) med.push(median(r.cy[k]));
  function put(L, t, x, y, S, cut){
    if(cut && L.last) L.k.push(keyStr(t - 0.001, L.last.x, L.last.y, L.last.S));
    if(cut || !L.last || Math.abs(x - L.last.x) > 0.004 || Math.abs(y - L.last.y) > 0.004 || Math.abs(S - L.last.S) > 0.6){
      L.k.push(keyStr(t, x, y, S)); L.last = {x: x, y: y, S: S};
    }
  }
  runs.forEach(function(run){
    var isSplit = run.key.charAt(0) === "S", ids = run.key.slice(1).split(",").map(Number), i, t;
    var val = isSplit ? 100 : 0, ts = r.t[run.s];
    if(opLast === null) OP.push(ts.toFixed(3) + "," + val);
    else if(opLast !== val){ OP.push((ts - 0.001).toFixed(3) + "," + opLast); OP.push(ts.toFixed(3) + "," + val); }
    opLast = val;
    if(isSplit){ nSplit++; secSplit += (run.e - run.s + 1) * 0.2; }
    for(i=run.s;i<=run.e;i++){
      t = r.t[i];
      var cut = i === run.s;
      if(isSplit){
        var a = o.swap ? ids[1] : ids[0], b = o.swap ? ids[0] : ids[1];
        put(B, t, xNorm(r.cx[a][i], gs, o.seqW), 0.25, gs.S, cut);
        put(T, t, xNorm(r.cx[b][i], gs, o.seqW), 0.75, gs.S, cut);
      } else {
        var z = zoomAt(o.zmode, o.zmax, t - c.inP, len), g = geom(r.W, r.H, o.seqW, o.seqH, o.seqH * z, o.basis);
        put(B, t, xNorm(r.cx[ids[0]][i], g, o.seqW), yNorm(med[ids[0]], g, o.seqH), g.S, cut);
      }
    }
  });
  if(opLast === 100) OP.push((r.t[r.t.length-1] + 0.2).toFixed(3) + ",100");
  return {base: B.k.join(";"), top: T.k.join(";"), opa: OP.join(";"), nSplit: nSplit, secSplit: secSplit, runs: runs.length};
}

async function runReframe(){
  status("Leyendo la selección…"); await getInfo();
  var clips = selVideo();
  if(!clips.length) throw new Error(NOSEL);
  var F = FORMATS[$("fmv").value], W = F[0], H = F[1], mode = $("rmv").value;
  if(info.w !== W || info.h !== H){
    if(!$("conv").checked) throw new Error("La secuencia es " + info.w + "×" + info.h + ". Activa 'Cambiar el tamaño de la secuencia' o cámbiala a " + W + "×" + H + ".");
    var ids = clips.map(function(c){ return c.t + ":" + c.c; });
    var v = String(await jsx("setSeqSize(" + W + "," + H + ")"));
    if(v !== "ok") throw new Error("No pude cambiar la secuencia. Hazlo a mano: Secuencia → Configuración de secuencia → " + W + "×" + H + ".");
    await getInfo();
    clips = info.v.filter(function(c){ return ids.indexOf(c.t + ":" + c.c) >= 0; });
    log("Secuencia cambiada a " + info.w + "x" + info.h);
  }
  var seqW = info.w, seqH = info.h, basis = $("sbasis").value, canSplit = canSplitFmt();
  status("Detectando personas…");
  var res = await runEngine("reframe", {step: 0.2}, clips.map(function(c, i){ return {id: i, path: c.path, start: c.inP, end: c.outP}; }), prog), done = 0;
  for(var i=0;i<clips.length;i++){
    var c = clips[i], r = res[i];
    status("Aplicando encuadre " + (i+1) + "/" + clips.length);
    if(!r || r.error){ log("Clip " + c.name + ": " + (r ? r.error : "sin datos")); continue; }
    var people = r.K || 0;
    if($("tmv").value === "fixed" && people){
      for(var kk = 0; kk < people; kk++){
        var mx = median(r.cx[kk]), my = median(r.cy[kk]);
        r.cx[kk] = r.cx[kk].map(function(){ return mx; }); r.cy[kk] = r.cy[kk].map(function(){ return my; });
      }
      log(c.name + ": cámara fija (sin seguimiento).");
    }
    if(!people) log(c.name + ": no encontré caras, centro el encuadre.");
    else if(mode === "auto") log(c.name + ": " + (people >= 2 ? people + " personas → pantalla dividida" : "1 persona → encuadre único"));
    var wantSplit = mode !== "single" && people >= 2;
    if(mode === "split" && people < 2) log(c.name + ": no encontré dos personas, uso un hablante.");
    if(wantSplit && !canSplit){ log(c.name + ": este formato es muy ancho para dividir, uso un hablante."); wantSplit = false; }
    var dyn = null;
    if(wantSplit && mode === "auto"){
      dyn = dynPlan(r, c, {zmode: $("zmv").value, zmax: $("zmax").value/100, seqW: seqW, seqH: seqH, basis: basis, swap: $("swap").checked});
      if(!dyn.nSplit){ log(c.name + ": nadie habla a la vez, solo sigo al que habla."); wantSplit = false; dyn = null; }
    }
    if(dyn){
      log(c.name + ": " + dyn.nSplit + " tramo(s) con pantalla dividida (" + dyn.secSplit.toFixed(0) + " s), el resto sigue al que habla.");
      var dup2 = String(await jsx("dupToTrack(" + c.t + "," + c.c + "," + (c.t+1) + ")"));
      if(dup2.indexOf("ok:") !== 0) throw new Error("No pude duplicar el clip en V" + (c.t+2) + " (" + dup2 + "). Deja libre esa pista.");
      var k3 = parseInt(dup2.split(":")[1], 10);
      var a1 = String(await jsx("applyMotion(" + c.t + "," + c.c + ",'" + dyn.base + "')"));
      var b1 = String(await jsx("applyMotion(" + (c.t+1) + "," + k3 + ",'" + dyn.top + "')"));
      var o1 = String(await jsx("applyOpacity(" + (c.t+1) + "," + k3 + ",'" + dyn.opa + "')"));
      if(a1 !== "ok" || b1 !== "ok" || o1 !== "ok") throw new Error("Premiere: " + (a1 !== "ok" ? a1 : (b1 !== "ok" ? b1 : o1)));
    } else if(wantSplit){
      if(people > 2) log(c.name + ": hay " + people + " personas, uso las dos de la izquierda.");
      var gs = geom(r.W, r.H, seqW, seqH, seqH/2, basis), top = $("swap").checked ? 1 : 0, bot = 1 - top;
      var dup = String(await jsx("dupToTrack(" + c.t + "," + c.c + "," + (c.t+1) + ")"));
      if(dup.indexOf("ok:") !== 0) throw new Error("No pude duplicar el clip en V" + (c.t+2) + " (" + dup + "). Deja libre esa pista.");
      var k2 = parseInt(dup.split(":")[1], 10);
      var a = String(await jsx("applyMotion(" + c.t + "," + c.c + ",'" + splitKeys(r, top, 0.25, gs, seqW) + "')"));
      var b = String(await jsx("applyMotion(" + (c.t+1) + "," + k2 + ",'" + splitKeys(r, bot, 0.75, gs, seqW) + "')"));
      if(a !== "ok" || b !== "ok") throw new Error("Premiere: " + (a !== "ok" ? a : b));
    } else {
      var spec = singleKeys(r, c, {zmode: $("zmv").value, zmax: $("zmax").value/100, seqW: seqW, seqH: seqH, basis: basis});
      var o = String(await jsx("applyMotion(" + c.t + "," + c.c + ",'" + spec + "')"));
      if(o !== "ok") throw new Error("Premiere: " + o);
    }
    done++;
  }
  $("n1").textContent = done; $("l1").textContent = "clips";
  return "Listo: " + done + " clip(s) reencuadrado(s) a " + $("fmv").value.replace("x", ":") + ".";
}

/* ---------- Momentos virales y hook ---------- */
var V_Q1 = ["como","por que","que","cual","cuales","quien","cuanto","cuando","donde","sabias","sabes","imagina","imaginate","adivina","how","why","what","who","did you know","imagine","guess"];
var V_CLAIM = ["secreto","secretos","nadie","nunca","jamas","error","errores","verdad","mentira","increible","locura","loco","cuidado","ojo","peor","mejor","gratis","millones","millon","dinero","clave","razon","problema","truco","trucos","hack","peligro","prohibido","urgente","escucha","mira","atencion","descubri","confieso","revelo","cambio","cambiara","secret","nobody","never","mistake","mistakes","truth","lie","insane","crazy","warning","worst","best","free","million","money","key","reason","problem","trick","stop","listen","watch","careful","shocking"];
var V_PROMISE = ["te voy a","voy a mostrar","voy a contar","te cuento","te ensen","vas a","en este video","lo que nadie","la razon por","la clave","i m going to","i will show","you ll","let me show","here s why","here is why"];
var V_CONTRAST = ["pero","sin embargo","aunque","but","however"];
var V_YOU = ["tu","te","ti","usted","ustedes","you","your"];
var V_NUMW = ["mil","cien","ciento","millon","millones","thousand","hundred","million","billion","percent","porciento"];

function vNorm(t){ return " " + t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9%$ ]+/g," ").replace(/\s+/g," ").trim() + " "; }
function vHas(n, list){ var c = 0; list.forEach(function(w){ if(n.indexOf(" " + w + " ") >= 0 || (w.indexOf(" ") > 0 && n.indexOf(w) >= 0)) c++; }); return c; }
function sigm(x){ return 1 / (1 + Math.exp(-x)); }
function clamp(x, a, b){ return Math.min(Math.max(x, a), b); }
function fmtMS(t){ t = Math.max(0, Math.round(t)); var h = Math.floor(t/3600), m = Math.floor(t/60) % 60, s = t % 60; return (h ? h + ":" + ("0"+m).slice(-2) : m) + ":" + ("0"+s).slice(-2); }

function buildSentences(words){
  var out = [], cur = null;
  words.forEach(function(w, i){
    if(!cur) cur = {w: [], s: w.s, e: w.e, raw: ""};
    cur.w.push(w); cur.e = w.e; cur.raw += (cur.raw ? " " : "") + w.raw;
    var next = words[i+1], gap = next ? next.s - w.e : 99;
    if(/[.?!…]["')\]]*$/.test(w.raw) || gap > 0.8 || cur.w.length >= 28){ out.push(cur); cur = null; }
  });
  if(cur) out.push(cur);
  return out.filter(function(s){ return s.w.length >= 3; }).map(function(s){ s.text = s.raw.replace(/\s+/g, " ").trim(); s.n = s.w.length; return s; });
}
function dbMean(G, a, b){
  if(!G.t.length) return null;
  var lo = 0, hi = G.t.length;
  while(lo < hi){ var m = (lo + hi) >> 1; if(G.t[m] < a) lo = m + 1; else hi = m; }
  var sum = 0, n = 0, i;
  for(i = lo; i < G.t.length && G.t[i] <= b; i++){ sum += G.db[i]; n++; }
  return n ? sum / n : null;
}
function dbStd(G, a, b){
  var lo = 0, hi = G.t.length;
  while(lo < hi){ var m = (lo + hi) >> 1; if(G.t[m] < a) lo = m + 1; else hi = m; }
  var v = [], i; for(i = lo; i < G.t.length && G.t[i] <= b; i++) if(G.db[i] > -60) v.push(G.db[i]);
  if(v.length < 3) return 0;
  var mu = v.reduce(function(x, y){ return x + y; }, 0) / v.length;
  return Math.sqrt(v.reduce(function(x, y){ return x + (y - mu) * (y - mu); }, 0) / v.length);
}
function prepStats(sents, G){
  var rates = sents.map(function(s){ return s.n / Math.max(s.e - s.s, 0.3); });
  var rmu = rates.reduce(function(a, b){ return a + b; }, 0) / Math.max(rates.length, 1);
  var rsd = Math.sqrt(rates.reduce(function(a, b){ return a + (b - rmu) * (b - rmu); }, 0) / Math.max(rates.length, 1)) || 1;
  var voiced = G.db.filter(function(x){ return x > -60; });
  var mu = voiced.reduce(function(a, b){ return a + b; }, 0) / Math.max(voiced.length, 1);
  var sd = Math.sqrt(voiced.reduce(function(a, b){ return a + (b - mu) * (b - mu); }, 0) / Math.max(voiced.length, 1)) || 1;
  G.rmu = rmu; G.rsd = rsd; G.mu = mu; G.sd = sd;
}
function scoreSentence(s, G){
  var n = vNorm(s.text), toks = n.trim().split(" "), first = toks.slice(0, 3).join(" ");
  var hasQ = /[?¿]/.test(s.text), qw = V_Q1.some(function(w){ return first.indexOf(w) === 0; });
  var q = hasQ ? 1 : (qw ? 0.25 : 0);
  var num = (/\d|%|\$/.test(s.text) || vHas(n, V_NUMW) > 0) ? 1 : 0;
  var claim = Math.min(vHas(n, V_CLAIM), 2), promise = vHas(n, V_PROMISE) > 0 ? 1 : 0;
  var contrast = vHas(n, V_CONTRAST) > 0 ? 1 : 0, you = vHas(n, V_YOU) > 0 ? 1 : 0, ex = /!/.test(s.text) ? 1 : 0;
  var m = dbMean(G, s.s, s.e), zE = m === null ? 0 : clamp((m - G.mu) / G.sd, -1, 2);
  var zR = clamp((s.n / Math.max(s.e - s.s, 0.3) - G.rmu) / G.rsd, -1, 1.5);
  var len = (s.n >= 5 && s.n <= 18) ? 0.4 : (s.n > 25 ? -0.6 : 0);
  var raw = 1.6*q + 1.0*num + 0.9*claim + 1.0*promise + 0.5*contrast + 0.4*you + 0.5*ex + 0.8*zE + 0.4*zR + len;
  var why = [];
  if(q >= 0.6) why.push("pregunta"); if(num) why.push("dato o número"); if(claim) why.push("palabra fuerte"); if(promise) why.push("promesa"); if(zE > 0.8) why.push("voz enérgica");
  return {raw: raw, p: Math.round(100 * sigm((raw - 2.0) / 1.0)), why: why};
}
var V_LEN = {s: [15, 30], m: [30, 60], l: [60, 90]};
function findMoments(sents, G, lenKey, maxN){
  var L = V_LEN[lenKey], res = [], i, j;
  sents.forEach(function(s){ var sc = scoreSentence(s, G); s.raw = sc.raw; s.p = sc.p; s.why = sc.why; });
  for(i = 0; i < sents.length; i++){
    var s0 = sents[i].s, end = i;
    for(j = i; j < sents.length && sents[j].e - s0 <= L[1]; j++) end = j;
    var dur = sents[end].e - s0;
    if(dur < L[0] * 0.7 && !(end === sents.length - 1 && dur >= 8)) continue;
    var win = sents.slice(i, end + 1), open = -9, body = 0, hk = null;
    win.forEach(function(x){
      if(x.s <= s0 + 10 && x.raw > open) open = x.raw;
      body += x.raw; if(!hk || x.raw > hk.raw) hk = x;
    });
    body /= win.length;
    var dyn = clamp((dbStd(G, s0, s0 + dur) - 6) / 6, 0, 1.5);
    var dens = clamp((win.reduce(function(a, x){ return a + x.n; }, 0) / Math.max(dur, 1) - G.rmu * 0.7) / G.rsd, -1, 1.5);
    var raw = 0.5*open + 0.3*body + 0.6*dyn + 0.3*dens;
    res.push({s: s0, e: sents[end].e, raw: raw, score: Math.round(100 * sigm((raw - 1.5) / 0.8)), hook: hk, first: win[0].text});
  }
  res.sort(function(a, b){ return b.raw - a.raw; });
  var pick = [];
  res.forEach(function(m){
    if(pick.length >= maxN) return;
    if(pick.some(function(x){ return m.s < x.e + 3 && m.e > x.s - 3; })) return;
    pick.push(m);
  });
  pick.forEach(function(m){
    var h = m.hook;
    m.hookOk = !!h && h.p >= 60;
    m.late = m.hookOk && (h.s - m.s) > 3;
    m.weakStart = m.hookOk && m.late;
  });
  return pick.sort(function(a, b){ return b.score - a.score; });
}
function esc2(t){ return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
function scoreColor(p){ return p >= 75 ? "#2dd36f" : (p >= 50 ? "#ffb454" : "#8a8ca3"); }
function momentCard(m, i){
  var h = m.hook, tags = "";
  if(m.hookOk) tags += '<span class="vtag">🔥 HOOK ' + fmtMS(h.s) + ' · ' + h.p + '%</span>';
  if(m.late) tags += '<span class="vtag warn">Empieza en ' + fmtMS(h.s) + '</span>';
  if(m.hookOk && h.why.length) tags += '<span class="vtag warn">' + esc2(h.why.slice(0, 2).join(" + ")) + '</span>';
  return '<div class="vcard"><div class="vh"><div class="vscore" style="--p:' + m.score + ';--c:' + scoreColor(m.score) + '"><span>' + m.score + '</span></div>' +
    '<div class="vt"><b>#' + (i+1) + ' · ' + fmtMS(m.s) + ' – ' + fmtMS(m.e) + '</b><small>' + Math.round(m.e - m.s) + ' s · potencial ' + (m.score >= 75 ? "alto" : m.score >= 50 ? "medio" : "bajo") + '</small></div></div>' +
    (tags ? '<div>' + tags + '</div>' : '') + '<div class="vtxt">“' + esc2((m.hookOk ? h.text : m.first).slice(0, 160)) + '”</div>' +
    '<div class="vbtn"><button data-go="' + (m.late ? h.s : m.s).toFixed(2) + '">Ir al momento</button></div></div>';
}
$("vres").onclick = function(e){ var g = e.target.getAttribute && e.target.getAttribute("data-go"); if(g) jsx("gotoTime(" + g + ")"); };
segment("vlen","vlv");
bindSlider("vn","vnv",function(v){ return v; });

async function runViral(){
  status("Leyendo la selección…"); await getInfo();
  var clips = selAudio();
  if(!clips.length) throw new Error(NOSEL);
  var jobs = mergeJobs(clips);
  status("Transcribiendo…");
  var wres = await runEngine("transcribe", {model: $("model").value, lang: $("vlang").value}, jobs, function(p){ prog(p * 0.7); });
  status("Midiendo energía de la voz…");
  var eres = null;
  try{ eres = await runEngine("energy", {step: 0.25}, clips.map(function(c, i){ return {id: i, path: c.path, start: c.inP, end: c.outP}; }), function(p){ prog(0.7 + p * 0.2); }); }
  catch(e){ log("Sin energía de audio (" + e.message + "). El puntaje usará solo el texto."); }
  var words = [], G = {t: [], db: []};
  clips.forEach(function(c, i){
    wordsOf(c, jobs, wres).forEach(function(w){
      var s = c.s + (Math.max(w[1], c.inP) - c.inP), e = c.s + (Math.min(w[2], c.outP) - c.inP);
      words.push({raw: w[0], s: s, e: Math.max(e, s + 0.05)});
    });
    var er = eres && eres[i];
    if(er && !er.error) er.db.forEach(function(d, k){ G.t.push(c.s + (er.base + k * er.step - c.inP)); G.db.push(d); });
  });
  var order = G.t.map(function(_, k){ return k; }).sort(function(a, b){ return G.t[a] - G.t[b]; });
  G.t = order.map(function(k){ return G.t[k]; }); G.db = order.map(function(k){ return G.db[k]; });
  words.sort(function(a, b){ return a.s - b.s; });
  if(words.length < 8) throw new Error("Casi no hay voz en la selección para analizar.");
  status("Puntuando momentos…");
  var sents = buildSentences(words);
  prepStats(sents, G);
  var moments = findMoments(sents, G, $("vlv").value, parseInt($("vn").value, 10));
  if(!moments.length) throw new Error("La selección es muy corta para esa duración. Prueba con '15–30 s' o selecciona más material.");
  log(sents.length + " frases analizadas, " + moments.length + " momentos");
  var best = moments[0], hookTop = sents.slice().sort(function(a, b){ return b.raw - a.raw; })[0];
  var html = '<div class="vsum"><div class="big">' + best.score + '%</div><div><b>Mejor momento: ' + fmtMS(best.s) + ' – ' + fmtMS(best.e) + '</b><small>' +
    (hookTop && hookTop.p >= 60 ? 'Hook más fuerte en ' + fmtMS(hookTop.s) + ' (' + hookTop.p + '%)' : 'No encontré un hook claro: busca abrir con una pregunta o un dato') + '</small></div></div>';
  html += moments.map(momentCard).join("");
  html += '<div class="vnote">Es una estimación basada en el texto (preguntas, datos, palabras fuertes, promesas) y la energía de la voz. No garantiza viralidad: úsala como guía.</div>';
  $("vres").innerHTML = html;
  if($("vmark").checked){
    var items = [];
    moments.forEach(function(m, i){
      var note = "Potencial " + m.score + "%. " + (m.hookOk ? "Hook en " + fmtMS(m.hook.s) + " (" + m.hook.p + "%): " + m.hook.text : "Sin hook claro.") + (m.late ? " Sugerencia: empezar el clip en " + fmtMS(m.hook.s) + "." : "");
      items.push({s: m.s, e: m.e, name: "Viral " + m.score + "% #" + (i+1), note: note, color: m.score >= 75 ? 0 : 4});
      if(m.hook){
        var he = Math.max(m.hook.e, m.hook.s + 1.5);
        items.push({s: m.hook.s, e: he, name: (m.hookOk ? "HOOK " : "Posible hook ") + m.hook.p + "%", note: "Momento #" + (i+1) + ". " + m.hook.text + (m.late ? " (empieza " + Math.round(m.hook.s - m.s) + " s después del inicio del momento)" : ""), color: m.hookOk ? 1 : 4});
      }
    });
    var js = JSON.stringify(items).replace(/[\u007f-￿]/g, function(ch){ return "\\u" + ("0000" + ch.charCodeAt(0).toString(16)).slice(-4); });
    var r = String(await jsx("addMarks('" + qs(js) + "')"));
    if(r.indexOf("ok:") !== 0) throw new Error("Premiere: " + r);
    log(r.split(":")[1] + " marcadores creados en la secuencia");
  }
  $("n1").textContent = moments.length; $("l1").textContent = "momentos";
  return "Listo: mejor momento " + best.score + "% en " + fmtMS(best.s) + ".";
}


/* ---------- Multicámara: quién habla y cuándo cambiar ---------- */
function mcPct(arr, q){
  var v = arr.filter(function(x){ return x > -79; }).sort(function(a, b){ return a - b; });
  return v.length ? v[Math.min(v.length - 1, Math.floor(q * v.length))] : -80;
}
function mcThr(db){ var fl = mcPct(db, 0.1), sp = mcPct(db, 0.9); return fl + Math.max(0.35 * (sp - fl), 6); }
// un micro por persona: dbs[p][i] en dB. Devuelve, por celda, la lista de personas que hablan
function mcMicSets(dbs, bleedDb){
  var n = dbs[0].length, thr = dbs.map(mcThr), out = [], i, p;
  for(i = 0; i < n; i++){
    var ex = [], mx = -1e9;
    for(p = 0; p < dbs.length; p++){ ex[p] = dbs[p][i] - thr[p]; if(ex[p] > 0 && ex[p] > mx) mx = ex[p]; }
    var set = [];
    for(p = 0; p < dbs.length; p++) if(ex[p] > 0 && ex[p] >= mx - bleedDb) set.push(p);
    out.push(set);
  }
  return out;
}
// audio mezclado + actividad de la boca de cada cámara
function mcMouthSets(acts, voiceDb){
  var n = voiceDb.length, rng = mcPct(voiceDb, 0.9) - mcPct(voiceDb, 0.1);
  var vthr = rng < 10 ? -100 : mcThr(voiceDb), out = [], i, p;
  var thr = acts.map(function(a){ var s = a.slice().sort(function(x, y){ return x - y; }); return Math.max(0.5 * (s[Math.floor(0.9 * (s.length - 1))] || 0), 0.01); });
  for(i = 0; i < n; i++){
    if(voiceDb[i] <= vthr){ out.push([]); continue; }
    var r = [], mx = 0;
    for(p = 0; p < acts.length; p++){ r[p] = acts[p][i] / thr[p]; if(r[p] > mx) mx = r[p]; }
    var set = [];
    if(mx >= 1) for(p = 0; p < acts.length; p++) if(r[p] >= 1 && r[p] >= mx / 1.8) set.push(p);
    out.push(set);
  }
  return out;
}
var MC_WIDE = 99;
// sets: por celda de dt segundos. Devuelve [{s,e,k}] con k = persona o MC_WIDE
function mcSegments(sets, dt, lo, o){
  var n = sets.length, L = [], i, j, k;
  for(i = 0; i < n; i++) L.push(sets[i].length === 0 ? -1 : (sets[i].length === 1 ? sets[i][0] : MC_WIDE));
  var minOv = Math.max(1, Math.round(o.minOverlap / dt));
  i = 0;
  while(i < n){
    if(L[i] !== MC_WIDE){ i++; continue; }
    j = i; while(j < n && L[j] === MC_WIDE) j++;
    if(j - i < minOv) for(k = i; k < j; k++) L[k] = -1;
    i = j;
  }
  var first = -1; for(i = 0; i < n; i++) if(L[i] !== -1){ first = L[i]; break; }
  if(first === -1) return [];
  var last = first; for(i = 0; i < n; i++){ if(L[i] === -1) L[i] = last; else last = L[i]; }
  if(!o.hasWide){
    last = null; for(i = 0; i < n; i++){ if(L[i] === MC_WIDE) L[i] = last === null ? -3 : last; else last = L[i]; }
    last = null; for(i = n - 1; i >= 0; i--){ if(L[i] === -3) L[i] = last; else last = L[i]; }
  }
  var segs = []; i = 0;
  while(i < n){ j = i; while(j < n && L[j] === L[i]) j++; segs.push({a: i, b: j, k: L[i]}); i = j; }
  var minShot = Math.max(1, Math.round(o.minShot / dt)), changed = true, guard = 0;
  while(changed && segs.length > 1 && guard++ < 10000){
    changed = false;
    for(i = 0; i < segs.length; i++){
      if(segs[i].b - segs[i].a < minShot){
        var t = i > 0 ? i - 1 : 1;
        segs[t].a = Math.min(segs[t].a, segs[i].a); segs[t].b = Math.max(segs[t].b, segs[i].b);
        segs.splice(i, 1); changed = true; break;
      }
    }
    for(i = 1; i < segs.length; ){ if(segs[i].k === segs[i-1].k){ segs[i-1].b = segs[i].b; segs.splice(i, 1); } else i++; }
  }
  var starts = segs.map(function(sg){ return lo + sg.a * dt; }), end = lo + n * dt;
  for(i = 1; i < starts.length; i++) starts[i] = Math.max(starts[i] - o.lead, starts[i-1] + 0.3);
  var res = [];
  for(i = 0; i < segs.length; i++){
    var s0 = starts[i], e0 = i + 1 < segs.length ? starts[i+1] : end;
    if(o.hasWide && o.vary > 0 && segs[i].k !== MC_WIDE){
      while(e0 - s0 > o.vary + 3){ res.push({s: s0, e: s0 + o.vary, k: segs[i].k}); res.push({s: s0 + o.vary, e: s0 + o.vary + 2, k: MC_WIDE}); s0 += o.vary + 2; }
    }
    res.push({s: s0, e: e0, k: segs[i].k});
  }
  return res;
}


/* ---------- Multicámara: interfaz y flujo ---------- */
var MC = {cams: [], auds: [], role: {cam: {}, aud: {}}, main: null};
var MC_ROLES = [["p0","Persona 1"],["p1","Persona 2"],["p2","Persona 3"],["p3","Persona 4"],["wide","Plano amplio"],["skip","Ignorar"]];
function mcOpts(sel){ return MC_ROLES.map(function(r){ return '<option value="' + r[0] + '"' + (r[0] === sel ? " selected" : "") + '>' + r[1] + '</option>'; }).join(""); }
function mcGroup(list){
  var seen = {}, out = [];
  list.filter(function(c){ return c.sel; }).forEach(function(c){ if(!seen[c.t]){ seen[c.t] = 1; out.push({t: c.t, name: c.name}); } });
  return out.sort(function(a, b){ return a.t - b.t; });
}
function mcRender(){
  MC.cams = mcGroup(info.v); MC.auds = mcGroup(info.a);
  var n = MC.cams.length;
  MC.cams.forEach(function(c, i){
    if(!MC.role.cam[c.t]) MC.role.cam[c.t] = (n >= 3 && i === n - 1) ? "wide" : "p" + Math.min(i, 3);
  });
  var mic = $("mcsv").value === "mic";
  MC.auds.forEach(function(a, i){ if(!MC.role.aud[a.t]) MC.role.aud[a.t] = i < 4 ? "p" + i : "skip"; });
  if(MC.main === null || !MC.auds.some(function(a){ return a.t === MC.main; })) MC.main = MC.auds.length ? MC.auds[0].t : null;
  $("mcCams").innerHTML = n ? MC.cams.map(function(c){
    return '<div class="mrow"><span><em>V' + (c.t + 1) + '</em>' + esc2(c.name) + '</span><select data-k="cam" data-t="' + c.t + '">' + mcOpts(MC.role.cam[c.t]) + '</select></div>';
  }).join("") : '<div class="mempty">No hay clips de video seleccionados.</div>';
  if(!MC.auds.length) $("mcAud").innerHTML = '<div class="mempty">No hay clips de audio seleccionados.</div>';
  else if(mic) $("mcAud").innerHTML = MC.auds.map(function(a){
    return '<div class="mrow"><span><em>A' + (a.t + 1) + '</em>' + esc2(a.name) + '</span><select data-k="aud" data-t="' + a.t + '">' + mcOpts(MC.role.aud[a.t]) + '</select></div>';
  }).join("");
  else $("mcAud").innerHTML = '<div class="mrow"><span>Audio principal</span><select data-k="main">' + MC.auds.map(function(a){
    return '<option value="' + a.t + '"' + (a.t === MC.main ? " selected" : "") + '>A' + (a.t + 1) + ' · ' + esc2(a.name).slice(0, 18) + '</option>'; }).join("") + '</select></div>';
}
async function mcLoad(){
  try{ await getInfo(); mcRender(); }
  catch(e){ $("mcCams").innerHTML = '<div class="mempty">' + esc2(e.message) + '</div>'; $("mcAud").innerHTML = ""; }
}
$("mcRefresh").onclick = mcLoad;
segment("mcsrc","mcsv", function(){ if(info) mcRender(); });
$("multi").onchange = function(e){
  var k = e.target.getAttribute && e.target.getAttribute("data-k"), t = e.target.getAttribute && e.target.getAttribute("data-t");
  if(k === "cam") MC.role.cam[t] = e.target.value; else if(k === "aud") MC.role.aud[t] = e.target.value; else if(k === "main") MC.main = parseInt(e.target.value, 10);
};
bindSlider("mcShot","mcShotv",function(v){ return (v/10).toFixed(1) + " s"; });
bindSlider("mcLead","mcLeadv",function(v){ return (v/100).toFixed(2) + " s"; });
bindSlider("mcOv","mcOvv",function(v){ return (v/10).toFixed(1) + " s"; });

function mcFillDb(arr, c, er, lo, dt){
  if(!er || er.error) return;
  er.db.forEach(function(d, k){
    var idx = Math.round((c.s + (er.base + k * er.step - c.inP) - lo) / dt);
    if(idx >= 0 && idx < arr.length && d > arr[idx]) arr[idx] = d;
  });
}
function mcFillAct(arr, c, mr, lo, dt){
  if(!mr || mr.error) return;
  var set = new Array(arr.length), k;
  for(k = 0; k < mr.t.length; k++){
    var idx = Math.round((c.s + (mr.t[k] - c.inP) - lo) / dt);
    if(idx >= 0 && idx < arr.length) set[idx] = mr.a[k];
  }
  var last = 0, i;
  for(i = 0; i < arr.length; i++){ if(set[i] !== undefined){ last = set[i]; } if(i >= Math.round((c.s - lo) / dt) && i < Math.round((c.e - lo) / dt)) arr[i] = last; }
}

async function runMulticam(){
  status("Leyendo la selección…"); await getInfo(); mcRender();
  var vSel = info.v.filter(function(c){ return c.sel; });
  if(!vSel.length) throw new Error(NOSEL);
  var roleOf = function(t){ return MC.role.cam[t] || "skip"; };
  var keys = [], wideTrack = null, personCam = {};
  MC.cams.forEach(function(c){
    var r = roleOf(c.t);
    if(r === "wide"){ if(wideTrack === null) wideTrack = c.t; }
    else if(r !== "skip" && personCam[r] === undefined){ personCam[r] = c.t; keys.push(r); }
  });
  keys.sort();
  if(keys.length < 2) throw new Error("Asigna al menos dos cámaras como Persona 1 y Persona 2.");
  var persons = keys.map(function(k, i){ return {key: k, t: personCam[k], name: MC_ROLES.filter(function(r){ return r[0] === k; })[0][1]}; });
  var camTracks = persons.map(function(p){ return p.t; }); if(wideTrack !== null) camTracks.push(wideTrack);
  var camClips = vSel.filter(function(c){ return camTracks.indexOf(c.t) >= 0; });
  var lo = Math.min.apply(null, camClips.map(function(c){ return c.s; })), hi = Math.max.apply(null, camClips.map(function(c){ return c.e; }));
  var dt = 0.1, n = Math.ceil((hi - lo) / dt);
  if(n < 20) throw new Error("La selección es muy corta.");

  var mic = $("mcsv").value === "mic", aSel = info.a.filter(function(c){ return c.sel; });
  if(!aSel.length) throw new Error("Selecciona también los clips de audio.");
  var wantW = $("mcBleep").checked, wantS = $("mcSil").checked, wantSp = $("mcSp").checked, wantC = wantW || wantS || wantSp;
  PR.a = 0; PR.b = wantC ? 0.45 : 0.7;
  var sets, audClips = [];
  function blank(v){ var a = new Array(n), i; for(i = 0; i < n; i++) a[i] = v; return a; }

  if(mic){
    var dbs = [], jobs = [], owners = [];
    persons.forEach(function(p, k){
      var mine = aSel.filter(function(c){ return MC.role.aud[c.t] === p.key; });
      if(!mine.length) throw new Error("Falta un micro para " + p.name + ". Asígnalo a una pista de audio o usa 'Audio mezclado'.");
      mine.forEach(function(c){ jobs.push({id: jobs.length, path: c.path, start: c.inP, end: c.outP}); owners.push({k: k, c: c}); audClips.push(c); });
      dbs.push(blank(-80));
    });
    status("Midiendo quién habla en cada micro…");
    var er = await runEngine("energy", {step: dt}, jobs, prog);
    owners.forEach(function(o, j){ mcFillDb(dbs[o.k], o.c, er[j], lo, dt); });
    sets = mcMicSets(dbs, 8);
  } else {
    var mainClips = aSel.filter(function(c){ return c.t === MC.main; });
    if(!mainClips.length) throw new Error("Elige el audio principal.");
    audClips = mainClips;
    var mj = [], mo = [];
    persons.forEach(function(p, k){ camClips.filter(function(c){ return c.t === p.t; }).forEach(function(c){ mj.push({id: mj.length, path: c.path, start: c.inP, end: c.outP}); mo.push({k: k, c: c}); }); });
    var pm = 0, pe = 0;
    status("Detectando quién habla en cada cámara…");
    var rr = await Promise.all([
      runEngine("mouth", {step: 0.15}, mj, function(p){ pm = p; prog(0.85 * pm + 0.15 * pe); }),
      runEngine("energy", {step: dt}, mainClips.map(function(c, i){ return {id: i, path: c.path, start: c.inP, end: c.outP}; }), function(p){ pe = p; prog(0.85 * pm + 0.15 * pe); })
    ]);
    var acts = persons.map(function(){ return blank(0); }), voice = blank(-80);
    mo.forEach(function(o, j){ mcFillAct(acts[o.k], o.c, rr[0][j], lo, dt); if(rr[0][j] && !rr[0][j].error && rr[0][j].face < 0.3) log(persons[o.k].name + ": casi no se ve su cara en " + o.c.name + "."); });
    mainClips.forEach(function(c, i){ mcFillDb(voice, c, rr[1][i], lo, dt); });
    sets = mcMouthSets(acts, voice);
  }

  status("Decidiendo los cortes…");
  var hasWide = wideTrack !== null && $("mcWide").checked;
  if(!hasWide && $("mcWide").checked) log("No hay plano amplio asignado: en los solapes se mantiene la cámara anterior.");
  var segs = mcSegments(sets, dt, lo, {minShot: $("mcShot").value/10, lead: $("mcLead").value/100, minOverlap: $("mcOv").value/10, hasWide: hasWide, vary: $("mcVary").checked ? 15 : 0});
  if(!segs.length) throw new Error("No detecté a nadie hablando en la selección.");
  var share = {}; segs.forEach(function(sg){ var nm = sg.k === MC_WIDE ? "Amplio" : persons[sg.k].name; share[nm] = (share[nm] || 0) + (sg.e - sg.s); });
  log(segs.length + " planos · " + Object.keys(share).map(function(k){ return k + " " + Math.round(100 * share[k] / (hi - lo)) + "%"; }).join(" · "));
  var payload = segs.map(function(sg){ return {s: +sg.s.toFixed(3), e: +sg.e.toFixed(3), t: sg.k === MC_WIDE ? wideTrack : persons[sg.k].t}; });

  PR.a = PR.b; PR.b = wantC ? 0.6 : 1;
  status("Cortando las cámaras…");
  var times = payload.slice(1).map(function(sg){ return sg.s; });
  for(var i = 0; i < times.length; i += 40){
    var rz = String(await jsx("camRazor('" + qs(JSON.stringify({tracks: camTracks, times: times.slice(i, i + 40)})) + "')"));
    if(rz.indexOf("ok:") !== 0) throw new Error("Premiere: " + rz);
    prog(Math.min(i + 40, times.length) / Math.max(times.length, 1) * 0.8);
  }
  status("Mostrando la cámara correcta…");
  var st = String(await jsx("camSet('" + qs(JSON.stringify({tracks: camTracks, segs: payload})) + "')"));
  if(st.indexOf("ok:") !== 0) throw new Error("Premiere: " + st);
  var parts = st.split(":"), touched = parseInt(parts[1], 10) || 0;
  if(!touched) throw new Error("No pude activar/desactivar las cámaras. Revisa que las pistas no estén bloqueadas.");
  log(touched + " tramos de cámara ajustados" + (parts[2] === "o" ? " (con opacidad)" : " (el resto queda desactivado, no borrado)"));
  prog(1);

  var extra = "";
  if(wantC){
    PR.a = 0.6; PR.b = 1;
    extra = " " + await cleanCore(audClips, wantW, wantS, wantSp);
  }
  $("n1").textContent = payload.length - 1; $("l1").textContent = "cambios de cámara";
  return "Listo: " + (payload.length - 1) + " cambios de cámara." + extra.replace(/^ Listo: /, " ");
}


/* ---------- Habla limpia: repeticiones, frases sin terminar, muletillas ---------- */
var SP_PURE = /^(eh+|e{2,}h*|ehm+|em+|mm+|hm+|um+|uhm+|uh+|ah{2,}|ahm+)$/;
var SP_CONNECT = ["que","y","e","o","pero","de","del","la","el","los","las","un","una","en","con","porque","si","para","por","a","como","cuando","mi","tu","su","lo","se","me","te","the","and","but","of","to","an","that","because","if","with","for","in","on","my","your"];
var SP_FILLERS = ["eh","ehh","em","mmm","hmm","um","uh","este","o sea","digamos"];
var SP_KEEP = ["muy","mucho","mucha","poco","tan","very","really","so","bla","ja","jaja"];
function spTok(raw){ var t = norm(raw); return t || ("#" + raw); }
function spEq(W, i, j, n){ for(var k = 0; k < n; k++){ if(W[i+k].t !== W[j+k].t || W[i+k].t.charAt(0) === "#") return false; } return true; }
// words: [[texto, ini, fin]] en segundos del archivo. Devuelve [{a,b,type,text,review}]
function spCuts(words, o){
  var W = words.map(function(w){ return {raw: w[0], t: spTok(w[0]), s: w[1], e: w[2]}; }), N = W.length, cuts = [], i, j, k;
  var maxCut = o.maxCut || 8;
  function prevEnd(x){ return x > 0 ? W[x-1].e : -1e9; }
  function txt(a, b){ return W.slice(a, b + 1).map(function(w){ return w.raw; }).join(" ").replace(/[.,;:¿?¡!…]+/g, "").trim(); }
  function add(a, b, type, text, review){ if(b - a < 0.05 || b - a > maxCut) return; cuts.push({a: a, b: b, type: type, text: text, review: !!review}); }

  if(o.fill){
    var fl = (o.fillers || []).map(function(f){ return f.trim().split(/\s+/).map(norm).filter(Boolean); }).filter(function(f){ return f.length; }).sort(function(a, b){ return b.length - a.length; });
    for(i = 0; i < N; i++){
      for(k = 0; k < fl.length; k++){
        var f = fl[k], len = f.length;
        if(i + len > N) continue;
        var ok = true; for(j = 0; j < len; j++) if(W[i+j].t !== f[j]){ ok = false; break; }
        if(!ok) continue;
        var last = i + len - 1, pure = len === 1 && SP_PURE.test(f[0]);
        var gapA = last < N - 1 ? W[last+1].s - W[last].e : 9;
        if(!pure && !(gapA >= 0.25 || /[,…]["']?$/.test(W[last].raw))) continue;
        add(Math.max(W[i].s - 0.03, prevEnd(i)), Math.min(W[last].e + 0.05, last < N - 1 ? W[last+1].s : W[last].e + 0.05), "Muletilla", txt(i, last));
        i = last; break;
      }
    }
  }
  if(o.rep){
    var claimed = new Array(N);
    for(var n = 4; n >= 1; n--){
      for(i = 0; i + 2 * n <= N; i++){
        var free = true; for(j = 0; j < n; j++) if(claimed[i+j]){ free = false; break; }
        if(!free || !spEq(W, i, i + n, n) || W[i+n].s - W[i+n-1].e >= 0.8) continue;
        if(n === 1 && SP_KEEP.indexOf(W[i].t) >= 0) continue;
        var r = 1;
        while(i + (r + 1) * n <= N && spEq(W, i, i + r * n, n) && W[i + r*n].s - W[i + r*n - 1].e < 0.8) r++;
        add(Math.max(W[i].s - 0.02, prevEnd(i)), W[i + (r-1) * n].s - 0.02, "Repetición", txt(i, i + r * n - 1));
        for(j = i; j < i + r * n; j++) claimed[j] = true;
        i += r * n - 1;
      }
    }
  }
  if(o.broken){
    var chunks = [], cur = null;
    for(i = 0; i < N; i++){
      if(cur && (W[i].s - W[i-1].e >= 0.45 || /[.?!]["')\]]*$/.test(W[i-1].raw))){ chunks.push(cur); cur = null; }
      if(!cur) cur = {a: i, b: i}; else cur.b = i;
    }
    if(cur) chunks.push(cur);
    for(k = 0; k + 1 < chunks.length; k++){
      var c = chunks[k], nx = chunks[k+1], lw = W[c.b], len2 = c.b - c.a + 1;
      var ended = /[.?!]["')\]]*$/.test(lw.raw) && !/(\.\.\.|…)["')\]]*$/.test(lw.raw);
      var gap = W[nx.a].s - lw.e;
      if(ended || gap < 0.45 || len2 > 9) continue;
      var restart = W[c.a].t === W[nx.a].t && W[c.a].t.charAt(0) !== "#" && (len2 <= 3 || (nx.a + 1 <= nx.b && W[c.a+1].t === W[nx.a+1].t));
      var a0 = Math.max(W[c.a].s - 0.02, prevEnd(c.a)), b0 = W[nx.a].s - 0.03;
      if(restart) add(a0, b0, "Frase sin terminar", txt(c.a, c.b));
      else if(len2 >= 2 && SP_CONNECT.indexOf(lw.t) >= 0) add(W[c.a].s, lw.e, "Revisar frase colgada", txt(c.a, c.b), true);
    }
  }
  cuts.sort(function(x, y){ return x.a - y.a || (y.b - y.a) - (x.b - x.a); });
  return cuts.filter(function(x, ix){
    return !cuts.some(function(y, iy){ return iy !== ix && !(y.review && !x.review) && y.a <= x.a + 0.01 && y.b >= x.b - 0.01 && (y.b - y.a > x.b - x.a + 0.001 || (Math.abs((y.b - y.a) - (x.b - x.a)) <= 0.001 && iy < ix)); });
  });
}


/* ---------- Lista de muletillas ---------- */
var FL = {items: []};
function loadFL(){
  try{ var x = JSON.parse(localStorage.getItem("zc_fl")); if(x && x.length) return x; }catch(e){}
  return SP_FILLERS.map(function(w){ return {w: w, on: true}; });
}
function saveFL(){ try{ localStorage.setItem("zc_fl", JSON.stringify(FL.items)); }catch(e){} }
function renderFL(){
  var on = FL.items.filter(function(x){ return x.on; }).length;
  $("fsum").textContent = "Muletillas (" + on + " activas de " + FL.items.length + ")";
  $("fl").innerHTML = FL.items.map(function(x, i){
    return '<label class="wrow' + (x.on ? "" : " off") + '"><input type="checkbox" data-i="' + i + '"' + (x.on ? " checked" : "") + '><span>' + x.w.replace(/</g, "&lt;") + '</span><button data-del="' + i + '" title="Quitar">×</button></label>';
  }).join("");
}
$("fl").onclick = function(e){
  var d = e.target.getAttribute && e.target.getAttribute("data-del");
  if(d !== null && d !== undefined){ e.preventDefault(); FL.items.splice(parseInt(d, 10), 1); saveFL(); renderFL(); return; }
  var i = e.target.getAttribute && e.target.getAttribute("data-i");
  if(i !== null && i !== undefined){ FL.items[parseInt(i, 10)].on = e.target.checked; saveFL(); renderFL(); }
};
function addFiller(){
  var v = $("fnew").value.trim().toLowerCase(); if(!v) return;
  if(!FL.items.some(function(x){ return x.w === v; })) FL.items.unshift({w: v, on: true});
  $("fnew").value = ""; saveFL(); renderFL();
}
$("fadd").onclick = addFiller; $("fnew").onkeydown = function(e){ if(e.keyCode === 13) addFiller(); };
$("freset").onclick = function(){ FL.items = SP_FILLERS.map(function(w){ return {w: w, on: true}; }); saveFL(); renderFL(); };
FL.items = loadFL(); renderFL();

async function go(fn, btn, label){
  if(busy) return; busy = true; btn.disabled = true; btn.textContent = "Trabajando…";
  $("log").textContent = ""; $("n1").textContent = "0"; PR.a = 0; PR.b = 1; prog(0); startTimer();
  try{ var msg = await fn(); PR.a = 0; PR.b = 1; prog(1); status(msg); }
  catch(e){ status("Error: " + e.message); log(e.stack || e.message); }
  stopTimer(); busy = false; btn.disabled = false; btn.textContent = label;
}
$("goClean").onclick = function(){ go(runClean, $("goClean"), "Limpiar selección"); };
$("goReframe").onclick = function(){ go(runReframe, $("goReframe"), "Reencuadrar a 9:16"); };

$("goViral").onclick = function(){ go(runViral, $("goViral"), "Buscar momentos virales"); };

$("goMulti").onclick = function(){ go(runMulticam, $("goMulti"), "Montar multicámara"); };
