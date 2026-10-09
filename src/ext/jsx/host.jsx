// Si el silencio/encuadre queda corrido en el tiempo, cambia a false
var KEY_TIME_IS_MEDIA = true;
var TICKS = 254016000000;

function esc(s){ return String(s).replace(/\\/g,"\\\\").replace(/"/g,'\\"'); }

function selIds(seq){
  var ids = {}, sel, i;
  try{ sel = seq.getSelection(); for(i=0;i<sel.length;i++){ ids[sel[i].nodeId] = 1; } }catch(e){}
  return ids;
}
function isSel(cl, ids){
  try{ if(typeof cl.isSelected === "function") return cl.isSelected() ? 1 : 0; }catch(e){}
  try{ return ids[cl.nodeId] ? 1 : 0; }catch(e2){}
  return 0;
}
function getSelCount(){
  try{
    var seq = app.project.activeSequence;
    if(!seq) return "0";
    return String(seq.getSelection().length);
  }catch(e){ return "0"; }
}

function collect(tracks, kind, ids){
  var out = [], t, c;
  for(t=0; t<tracks.numTracks; t++){
    var tr = tracks[t];
    for(c=0; c<tr.clips.numItems; c++){
      var cl = tr.clips[c];
      try{
        if(!cl.projectItem) continue;
        var p = cl.projectItem.getMediaPath();
        if(!p) continue;
        out.push('{"t":'+t+',"c":'+c+',"path":"'+esc(p)+'","name":"'+esc(cl.name)+'","inP":'+cl.inPoint.seconds+',"outP":'+cl.outPoint.seconds+',"s":'+cl.start.seconds+',"e":'+cl.end.seconds+',"sel":'+isSel(cl, ids)+'}');
      }catch(e){}
    }
  }
  return out;
}

function getInfo(){
  var seq = app.project.activeSequence;
  if(!seq) return '{"error":"No hay una secuencia activa. Abre una secuencia y vuelve a intentar."}';
  var ids = selIds(seq);
  return '{"w":'+seq.frameSizeHorizontal+',"h":'+seq.frameSizeVertical+',"a":['+collect(seq.audioTracks, "a", ids).join(",")+'],"v":['+collect(seq.videoTracks, "v", ids).join(",")+']}';
}

function fpsOf(seq){ return TICKS / parseFloat(seq.timebase); }
function snap(seq, sec, mode){
  var f = sec * fpsOf(seq);
  if(mode < 0) return Math.floor(f + 1e-6);
  if(mode > 0) return Math.ceil(f - 1e-6);
  return Math.round(f);
}
function pad2(n){ return (n < 10 ? "0" : "") + n; }
function tcFromFrames(seq, f){
  try{
    var tm = new Time();
    tm.ticks = String(Math.round(f * parseFloat(seq.timebase)));
    var st = seq.getSettings();
    var r = tm.getFormatted(st.videoFrameRate, st.videoDisplayFormat);
    if(r) return r;
  }catch(e){}
  var fps = Math.round(fpsOf(seq));
  var ff = f % fps, s = Math.floor(f / fps);
  return pad2(Math.floor(s/3600)) + ":" + pad2(Math.floor(s/60)%60) + ":" + pad2(s%60) + ":" + pad2(ff);
}

function findComp(cl, names, matches){
  var i, n, m;
  for(i=0; i<cl.components.numItems; i++){
    n = cl.components[i].displayName; m = cl.components[i].matchName;
    var k;
    for(k=0;k<names.length;k++) if(n==names[k]) return cl.components[i];
    for(k=0;k<matches.length;k++) if(m && m.indexOf(matches[k])>=0 && m.indexOf("Channel")<0) return cl.components[i];
  }
  return null;
}
function findProp(comp, names, matches, fallbackIdx){
  var j, k;
  for(j=0; j<comp.properties.numItems; j++){
    var n = comp.properties[j].displayName, m = comp.properties[j].matchName;
    for(k=0;k<names.length;k++) if(n==names[k]) return comp.properties[j];
    for(k=0;k<matches.length;k++) if(m==matches[k]) return comp.properties[j];
  }
  return comp.properties[fallbackIdx];
}
function levelProp(cl){
  var vol = findComp(cl, ["Volume","Volumen"], ["Volume"]) || cl.components[0];
  return findProp(vol, ["Level","Nivel"], [], 1);
}

function muteKeys(cl, ms, me){
  var lvl = levelProp(cl), base = lvl.getValue();
  if(base === 0) base = 1;
  lvl.setTimeVarying(true);
  var off = KEY_TIME_IS_MEDIA ? 0 : cl.inPoint.seconds, pad = 0.03;
  var k = [[ms-off-pad, base],[ms-off,0],[me-off,0],[me-off+pad, base]], q;
  for(q=0;q<k.length;q++){ var tm = Math.max(0,k[q][0]); lvl.addKey(tm); lvl.setValueAtKey(tm, k[q][1]); }
}

// items "t,s,e,c,ms,me|..." (s,e = tiempo de secuencia; ms,me = tiempo del archivo)
function muteWords(spec){
  try{
    app.enableQE();
    var seq = app.project.activeSequence, q = qe.project.getActiveSequence();
    var fps = fpsOf(seq), half = 0.5 / fps;
    var items = spec.split("|"), byT = {}, i, k, n = 0, fb = 0;
    for(i=0;i<items.length;i++){
      if(!items[i]) continue;
      var p = items[i].split(",");
      if(!byT[p[0]]) byT[p[0]] = [];
      byT[p[0]].push({s:parseFloat(p[1]), e:parseFloat(p[2]), c:parseInt(p[3],10), ms:parseFloat(p[4]), me:parseFloat(p[5])});
    }
    for(var t in byT){
      var tt = parseInt(t,10), arr = byT[t], tr = q.getAudioTrackAt(tt), rr = [];
      for(i=0;i<arr.length;i++){
        var f0 = snap(seq, arr[i].s - 0.02, -1), f1 = snap(seq, arr[i].e + 0.02, 1);
        if(f1 <= f0) f1 = f0 + 1;
        var ok = true;
        try{ tr.razor(tcFromFrames(seq,f0)); tr.razor(tcFromFrames(seq,f1)); }catch(e){ ok = false; }
        rr.push({f0:f0, f1:f1, ok:ok, it:arr[i]});
      }
      for(i=0;i<rr.length;i++){
        var a = rr[i].f0 / fps, b = rr[i].f1 / fps, done = false;
        var clips = seq.audioTracks[tt].clips;
        for(k=0;k<clips.numItems;k++){
          var cl = clips[k], cs = cl.start.seconds, ce = cl.end.seconds;
          if(ce > cs && cs >= a - half && ce <= b + half){
            try{ levelProp(cl).setValue(0, true); done = true; }catch(e){}
          }
        }
        if(done){ n++; }
        else{
          try{
            var cl2 = seq.audioTracks[tt].clips[rr[i].it.c];
            muteKeys(cl2, rr[i].it.ms, rr[i].it.me); n++; fb++;
          }catch(e){}
        }
      }
    }
    return "ok:" + n + ":" + fb;
  }catch(err){ return "error:" + err; }
}

function razorAllAt(seq, q, tc){
  var i;
  for(i=0;i<seq.videoTracks.numTracks;i++){ try{ q.getVideoTrackAt(i).razor(tc); }catch(e){} }
  for(i=0;i<seq.audioTracks.numTracks;i++){ try{ q.getAudioTrackAt(i).razor(tc); }catch(e){} }
}
function piecesIn(tracks, s, e, half){
  var out = [], i, k;
  for(i=0;i<tracks.numTracks;i++){
    var clips = tracks[i].clips;
    for(k=0;k<clips.numItems;k++){
      var cl = clips[k], cs = cl.start.seconds, ce = cl.end.seconds;
      if(ce > cs && cs >= s - half && ce <= e + half) out.push(cl);
    }
  }
  return out;
}

// spec "s,e;s,e" (segundos de secuencia, ascendente) / mode: "cut" | "mark"
function cutSilences(spec, mode){
  try{
    var seq = app.project.activeSequence, parts = spec.split(";"), r = [], i;
    for(i=0;i<parts.length;i++){ if(!parts[i]) continue; var se = parts[i].split(","); r.push([parseFloat(se[0]), parseFloat(se[1])]); }
    if(mode == "mark"){
      for(i=0;i<r.length;i++){
        var mk = seq.markers.createMarker(r[i][0]);
        mk.name = "Silencio";
        try{ mk.end = r[i][1]; }catch(e){}
      }
      return "ok:" + r.length;
    }
    app.enableQE();
    var q = qe.project.getActiveSequence(), fps = fpsOf(seq), half = 0.5 / fps, n = 0;
    for(i=r.length-1;i>=0;i--){
      var f0 = snap(seq, r[i][0], 1), f1 = snap(seq, r[i][1], -1);
      if(f1 <= f0) continue;
      var s = f0 / fps, e = f1 / fps;
      razorAllAt(seq, q, tcFromFrames(seq, f1));
      razorAllAt(seq, q, tcFromFrames(seq, f0));
      var pcs = piecesIn(seq.videoTracks, s, e, half).concat(piecesIn(seq.audioTracks, s, e, half)), j;
      if(!pcs.length) continue;
      for(j=0;j<pcs.length-1;j++){ try{ pcs[j].remove(false, false); }catch(x){} }
      try{ pcs[pcs.length-1].remove(true, true); n++; }catch(x2){}
    }
    return "ok:" + n;
  }catch(err){ return "error:" + err; }
}

function setSeqSize(w, h){
  try{
    var seq = app.project.activeSequence;
    if(seq.frameSizeHorizontal == w && seq.frameSizeVertical == h) return "ok";
    var st = seq.getSettings();
    st.videoFrameWidth = w; st.videoFrameHeight = h;
    seq.setSettings(st);
    return (seq.frameSizeHorizontal == w && seq.frameSizeVertical == h) ? "ok" : "manual";
  }catch(e){ return "manual"; }
}

function motionProps(cl){
  var mo = findComp(cl, ["Motion","Movimiento"], ["Motion"]) || cl.components[1] || cl.components[0];
  return {
    pos: findProp(mo, ["Position","Posición","Posicion"], ["ADBE Position"], 0),
    sc: findProp(mo, ["Scale","Escala"], ["ADBE Scale"], 1)
  };
}

// spec "tiempo,x,y,escala;..."  (tiempo del archivo, x/y normalizados, escala en %)
function applyMotion(t, c, spec){
  try{
    var cl = app.project.activeSequence.videoTracks[t].clips[c], mp = motionProps(cl);
    var parts = spec.split(";"), off = KEY_TIME_IS_MEDIA ? 0 : cl.inPoint.seconds, i;
    if(parts.length < 2){
      var v = parts[0].split(",");
      mp.sc.setValue(parseFloat(v[3]), true);
      mp.pos.setValue([parseFloat(v[1]), parseFloat(v[2])], true);
      return "ok";
    }
    mp.pos.setTimeVarying(true);
    mp.sc.setTimeVarying(true);
    for(i=0;i<parts.length;i++){
      var kv = parts[i].split(","), tm = Math.max(0, parseFloat(kv[0]) - off);
      mp.pos.addKey(tm);
      mp.pos.setValueAtKey(tm, [parseFloat(kv[1]), parseFloat(kv[2])], true);
      mp.sc.addKey(tm);
      mp.sc.setValueAtKey(tm, parseFloat(kv[3]), true);
    }
    return "ok";
  }catch(err){ return "error:" + err; }
}

// spec "tiempo,valor;..."  (opacidad 0-100, tiempo del archivo)
function applyOpacity(t, c, spec){
  try{
    var cl = app.project.activeSequence.videoTracks[t].clips[c];
    var op = findComp(cl, ["Opacity","Opacidad"], ["Opacity"]);
    var p = findProp(op, ["Opacity","Opacidad"], ["ADBE Opacity"], 0);
    var parts = spec.split(";"), off = KEY_TIME_IS_MEDIA ? 0 : cl.inPoint.seconds, i;
    p.setTimeVarying(true);
    for(i=0;i<parts.length;i++){
      var kv = parts[i].split(","), tm = Math.max(0, parseFloat(kv[0]) - off);
      p.addKey(tm);
      p.setValueAtKey(tm, parseFloat(kv[1]), true);
    }
    return "ok";
  }catch(err){ return "error:" + err; }
}

// spec "tiempo,recorteSuperior%;..."  (agrega el efecto Crop si no existe)
function applyCrop(t, c, spec){
  try{
    app.enableQE();
    var seq = app.project.activeSequence, cl = seq.videoTracks[t].clips[c];
    var comp = findComp(cl, ["Crop","Recortar"], ["Crop"]);
    if(!comp){
      var q = qe.project.getActiveSequence(), tr = q.getVideoTrackAt(t), k, it = null, cs = cl.start.seconds;
      for(k=0;k<tr.numItems;k++){
        var x = tr.getItemAt(k), xs = null;
        try{ xs = parseFloat(x.start.secs); }catch(e1){}
        if(xs === null || isNaN(xs)){ try{ xs = x.start.seconds; }catch(e2){ xs = null; } }
        if(xs !== null && !isNaN(xs) && Math.abs(xs - cs) < 0.05){ it = x; break; }
      }
      if(!it) return "error:crop-sin-item";
      var fx = qe.project.getVideoEffectByName("Crop");
      if(!fx) fx = qe.project.getVideoEffectByName("Recortar");
      if(!fx) return "error:crop-sin-efecto";
      it.addVideoEffect(fx);
      cl = seq.videoTracks[t].clips[c];
      comp = findComp(cl, ["Crop","Recortar"], ["Crop"]);
    }
    if(!comp) return "error:crop-no-aplicado";
    var top = findProp(comp, ["Top","Superior","Arriba"], [], 1);
    var parts = spec.split(";"), off = KEY_TIME_IS_MEDIA ? 0 : cl.inPoint.seconds, i;
    if(parts.length < 2){ top.setValue(parseFloat(parts[0].split(",")[1]), true); return "ok"; }
    top.setTimeVarying(true);
    for(i=0;i<parts.length;i++){
      var kv = parts[i].split(","), tm = Math.max(0, parseFloat(kv[0]) - off);
      top.addKey(tm);
      top.setValueAtKey(tm, parseFloat(kv[1]), true);
    }
    return "ok";
  }catch(err){ return "error:" + err; }
}

function dupToTrack(t, c, nt){
  try{
    var seq = app.project.activeSequence, cl = seq.videoTracks[t].clips[c], pi = cl.projectItem;
    var oi = pi.getInPoint(), oo = pi.getOutPoint();
    pi.setInPoint(cl.inPoint.seconds, 4);
    pi.setOutPoint(cl.outPoint.seconds, 4);
    seq.videoTracks[nt].overwriteClip(pi, cl.start.seconds);
    try{ pi.setInPoint(oi.seconds, 4); pi.setOutPoint(oo.seconds, 4); }catch(e){}
    var cs = seq.videoTracks[nt].clips, k;
    for(k=0;k<cs.numItems;k++){
      if(Math.abs(cs[k].start.seconds - cl.start.seconds) < 0.05) return "ok:" + k;
    }
    return "error:no se encontro la copia";
  }catch(err){ return "error:" + err; }
}

// items: JSON [{s,e,name,note,color}] (segundos de secuencia)
function addMarks(json){
  try{
    var seq = app.project.activeSequence, items = eval("(" + json + ")"), i, n = 0;
    for(i=0;i<items.length;i++){
      var it = items[i], mk = seq.markers.createMarker(it.s);
      mk.name = it.name;
      try{ mk.comments = it.note; }catch(e1){}
      try{ if(it.e > it.s) mk.end = it.e; }catch(e2){}
      try{ mk.setColorByIndex(it.color); }catch(e3){}
      n++;
    }
    return "ok:" + n;
  }catch(err){ return "error:" + err; }
}

function gotoTime(sec){
  try{
    app.project.activeSequence.setPlayerPosition(String(Math.round(parseFloat(sec) * TICKS)));
    return "ok";
  }catch(e){ return "error:" + e; }
}

// ---------- Multicamara ----------
// json {tracks:[indices de pistas de camara], times:[segundos de secuencia]}
function camRazor(json){
  try{
    app.enableQE();
    var seq = app.project.activeSequence, q = qe.project.getActiveSequence();
    var o = eval("(" + json + ")"), i, k, n = 0;
    for(i=0;i<o.times.length;i++){
      var tc = tcFromFrames(seq, snap(seq, o.times[i], 0));
      for(k=0;k<o.tracks.length;k++){
        try{ q.getVideoTrackAt(o.tracks[k]).razor(tc); }catch(e){}
      }
      n++;
    }
    return "ok:" + n;
  }catch(err){ return "error:" + err; }
}

function setClipVisible(cl, visible){
  try{ cl.disabled = !visible; return "d"; }catch(e){}
  try{
    var op = findComp(cl, ["Opacity","Opacidad"], ["Opacity"]);
    var pr = findProp(op, ["Opacity","Opacidad"], ["ADBE Opacity"], 0);
    pr.setValue(visible ? 100 : 0, true);
    return "o";
  }catch(e2){}
  return "";
}

// json {tracks:[...], segs:[{s,e,t}]}  t = pista de la camara visible (o -1)
function camSet(json){
  try{
    var seq = app.project.activeSequence, o = eval("(" + json + ")"), segs = o.segs, i, k, n = 0, mode = "";
    for(i=0;i<o.tracks.length;i++){
      var tr = seq.videoTracks[o.tracks[i]], clips = tr.clips;
      for(k=0;k<clips.numItems;k++){
        var cl = clips[k], mid = (cl.start.seconds + cl.end.seconds) / 2, lo = 0, hi = segs.length - 1, hit = -1;
        while(lo <= hi){
          var m = (lo + hi) >> 1;
          if(mid < segs[m].s) hi = m - 1; else if(mid >= segs[m].e) lo = m + 1; else { hit = m; break; }
        }
        if(hit < 0 || segs[hit].t < 0) continue;
        var r = setClipVisible(cl, segs[hit].t == o.tracks[i]);
        if(r){ mode = r; n++; }
      }
    }
    return "ok:" + n + ":" + mode;
  }catch(err){ return "error:" + err; }
}
