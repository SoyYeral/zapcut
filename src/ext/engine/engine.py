import sys, os, json, hashlib, tempfile
import numpy as np
sys.stdout.reconfigure(encoding="utf-8")

def progress(p):
    print("PROGRESS %.3f" % min(max(p, 0.0), 1.0), file=sys.stderr, flush=True)

def add_dll_dirs():
    if os.name != "nt":
        return
    try:
        import site
        for base in site.getsitepackages():
            nv = os.path.join(base, "nvidia")
            if os.path.isdir(nv):
                for d in os.listdir(nv):
                    b = os.path.join(nv, d, "bin")
                    if os.path.isdir(b):
                        os.add_dll_directory(b)
                        os.environ["PATH"] = b + os.pathsep + os.environ.get("PATH", "")
    except Exception:
        pass

def load_audio(path, start=0.0, end=None, sr=16000):
    import av
    c = av.open(path)
    s = c.streams.audio[0]
    if start > 1.0:
        c.seek(int((start - 1.0) * 1000000))
    rs = av.AudioResampler(format="s16", layout="mono", rate=sr)
    chunks, t_first = [], None
    def push(res):
        for f in (res if isinstance(res, list) else [res]):
            if f is not None:
                chunks.append(f.to_ndarray().reshape(-1))
    for frame in c.decode(s):
        t = frame.time
        if t is not None:
            if end is not None and t > end:
                break
            if t + frame.samples / float(frame.sample_rate) < start:
                continue
            if t_first is None:
                t_first = t
        push(rs.resample(frame))
    try:
        push(rs.resample(None))
    except Exception:
        pass
    c.close()
    if not chunks:
        return np.zeros(0, dtype=np.int16), start
    a = np.concatenate(chunks)
    base = t_first if t_first is not None else start
    if base < start:
        off = int((start - base) * sr)
        a, base = a[off:], start
    if end is not None:
        a = a[: int(max(end - base, 0) * sr)]
    return a, base

def cache_key(*a):
    return hashlib.md5("|".join(str(x) for x in a).encode("utf-8")).hexdigest()

def cache_dir():
    d = os.path.join(tempfile.gettempdir(), "zapcut_cache")
    os.makedirs(d, exist_ok=True)
    return d

def do_transcribe(params, jobs):
    add_dll_dirs()
    from faster_whisper import WhisperModel, BatchedInferencePipeline
    name = params.get("model", "small")
    lang = params.get("lang", "es")
    lang = None if lang == "auto" else lang
    disf = bool(params.get("disf", False))
    prompt = None
    if disf:
        prompt = ("Eh... o sea, o sea, este... pues, pues, yo creo que... yo creo que, bueno, mmm. Sí, sí, sí." if lang in ("es", None)
                  else "Um, uh, you know, I I think that, like, uh... so, so, yeah, yeah.")
    dev, ct = "cpu", "int8"
    try:
        import ctranslate2
        if ctranslate2.get_cuda_device_count() > 0:
            dev, ct = "cuda", "float16"
    except Exception:
        pass
    state = {}
    def get_pipe(d, c):
        key = (d, c)
        if key not in state:
            m = WhisperModel(name, device=d, compute_type=c, cpu_threads=min(8, os.cpu_count() or 4))
            state[key] = BatchedInferencePipeline(model=m)
        return state[key]
    out = {}
    for i, j in enumerate(jobs):
        try:
            ck = os.path.join(cache_dir(), cache_key("w", name, lang, disf, j["path"], os.path.getmtime(j["path"]), j["start"], j["end"]) + ".json")
            if os.path.exists(ck):
                out[j["id"]] = json.load(open(ck, encoding="utf-8"))
                progress((i + 1) / len(jobs))
                continue
            audio, base = load_audio(j["path"], j["start"], j["end"])
            x = audio.astype(np.float32) / 32768.0
            dur = max(len(x) / 16000.0, 0.1)
            words = []
            def run(d, c):
                pipe = get_pipe(d, c)
                kw = {"initial_prompt": prompt} if prompt else {}
                segs, _ = pipe.transcribe(x, language=lang, word_timestamps=True, beam_size=1,
                                          batch_size=16 if d == "cuda" else 8, **kw)
                res = []
                for seg in segs:
                    for w in (seg.words or []):
                        res.append([w.word.strip(), round(base + w.start, 3), round(base + w.end, 3)])
                    progress((i + min(seg.end / dur, 1.0)) / len(jobs))
                return res
            try:
                words = run(dev, ct)
            except Exception:
                if dev == "cuda":
                    dev, ct = "cpu", "int8"
                    words = run(dev, ct)
                else:
                    raise
            json.dump(words, open(ck, "w", encoding="utf-8"))
            out[j["id"]] = words
        except Exception as e:
            out[j["id"]] = {"error": str(e)[:200]}
        progress((i + 1) / len(jobs))
    return out

def do_silence(params, jobs):
    thresh = float(params.get("thresh", -38))
    auto = bool(params.get("auto", False))
    min_dur = float(params.get("min_dur", 0.4))
    pad = float(params.get("pad", 0.12))
    win = 160
    out = {}
    for i, j in enumerate(jobs):
        try:
            audio, base = load_audio(j["path"], j["start"], j["end"])
            m = len(audio) // win
            if m < 2:
                out[j["id"]] = {"silences": [], "thresh": thresh}
                continue
            x = audio[: m * win].astype(np.float32).reshape(m, win)
            rms = np.sqrt((x * x).mean(axis=1)) / 32768.0
            db = np.maximum(20.0 * np.log10(np.maximum(rms, 1e-9)), -80.0)
            th = thresh
            if auto:
                noise, speech = np.percentile(db, 10), np.percentile(db, 90)
                th = float(min(max(noise + 0.3 * (speech - noise), -55.0), -28.0))
            quiet = (db < th).astype(np.int8)
            d = np.diff(np.concatenate(([0], quiet, [0])))
            starts, ends = np.where(d == 1)[0], np.where(d == -1)[0]
            res = []
            for s, e in zip(starts, ends):
                a, b = base + s * 0.01, base + e * 0.01
                if b - a < min_dur:
                    continue
                a, b = a + pad, b - pad
                if b - a > 0.03:
                    res.append([round(a, 3), round(b, 3)])
            out[j["id"]] = {"silences": res, "thresh": round(th, 1)}
        except Exception as e:
            out[j["id"]] = {"error": str(e)[:200]}
        progress((i + 1) / len(jobs))
    return out

def do_reframe(params, jobs):
    import av
    import mediapipe as mp
    step = float(params.get("step", 0.2))
    out = {}
    for ji, j in enumerate(jobs):
        try:
            c = av.open(j["path"])
            v = c.streams.video[0]
            v.thread_type = "AUTO"
            try:
                v.codec_context.skip_frame = "NONREF"
            except Exception:
                pass
            W, H = v.codec_context.width, v.codec_context.height
            start, end = j["start"], j["end"]
            if start > 1.0:
                c.seek(int((start - 1.0) * 1000000), stream=v)
            tile = (W / float(H)) >= 1.5
            if tile:
                fm = mp.solutions.face_mesh.FaceMesh(static_image_mode=True, max_num_faces=2,
                                                     refine_landmarks=False, min_detection_confidence=0.5)
                BW = 1280
                BH = max(int(BW * H / float(W)) // 2 * 2, 2)
            else:
                fm = mp.solutions.face_mesh.FaceMesh(static_image_mode=False, max_num_faces=4,
                                                     refine_landmarks=False, min_detection_confidence=0.5,
                                                     min_tracking_confidence=0.5)
                h2 = max(int(480 * H / float(W)) // 2 * 2, 2)
            samples, nxt = [], start
            dur = max(end - start, 0.1)
            for frame in c.decode(v):
                if frame.time is None:
                    continue
                t = float(frame.time)
                if t < start or t < nxt:
                    continue
                if t > end:
                    break
                nxt = t + step
                faces = []
                if tile:
                    big = frame.reformat(width=BW, height=BH, format="rgb24").to_ndarray()
                    for x0, x1 in ((0.0, 0.56), (0.44, 1.0)):
                        crop = np.ascontiguousarray(big[:, int(x0 * BW):int(x1 * BW)])
                        res = fm.process(crop)
                        for fl in (res.multi_face_landmarks or []):
                            lm = fl.landmark
                            fh = max(abs(lm[152].y - lm[10].y), 1e-4)
                            cxl = float(np.mean([p.x for p in lm]))
                            faces.append((x0 + cxl * (x1 - x0), float(np.mean([p.y for p in lm])),
                                          abs(lm[14].y - lm[13].y) / fh))
                    faces.sort(key=lambda a: a[0])
                    ded = []
                    for f in faces:
                        if not ded or abs(f[0] - ded[-1][0]) > 0.06:
                            ded.append(f)
                    faces = ded
                else:
                    img = frame.reformat(width=480, height=h2, format="rgb24").to_ndarray()
                    res = fm.process(np.ascontiguousarray(img))
                    for fl in (res.multi_face_landmarks or []):
                        lm = fl.landmark
                        fh = max(abs(lm[152].y - lm[10].y), 1e-4)
                        faces.append((float(np.mean([p.x for p in lm])), float(np.mean([p.y for p in lm])),
                                      abs(lm[14].y - lm[13].y) / fh))
                samples.append((t, faces))
                progress((ji + min((t - start) / dur, 1.0)) / len(jobs))
            c.close()
            fm.close()
            out[j["id"]] = analyse_faces(samples, W, H, step)
        except Exception as e:
            out[j["id"]] = {"error": str(e)[:200]}
        progress((ji + 1) / len(jobs))
    return out

def analyse_faces(samples, W, H, step):
    n = len(samples)
    if n == 0:
        return {"W": W, "H": H, "K": 0, "t": [], "cx": [], "cy": [], "act": []}
    counts = [len(f) for _, f in samples if len(f) > 0]
    if not counts:
        return {"W": W, "H": H, "K": 0, "t": [s[0] for s in samples], "cx": [], "cy": [], "act": []}
    multi = [c for c in counts if c >= 2]
    p2 = len(multi) / float(len(counts))
    if p2 >= 0.25:
        K = min(max(int(np.bincount(multi).argmax()), 2), 3)
    else:
        K = 1
    ref = sorted([sorted(f, key=lambda a: a[0]) for _, f in samples if len(f) == K], key=lambda f: f[0][0])
    centers = [float(np.median([f[k][0] for f in ref])) for k in range(K)] if ref else [0.5] * K
    cx = np.full((K, n), np.nan); cy = np.full((K, n), np.nan); op = np.full((K, n), np.nan)
    for i, (_, faces) in enumerate(samples):
        used = set()
        for f in sorted(faces, key=lambda a: min(abs(a[0] - cc) for cc in centers)):
            order = sorted(range(K), key=lambda k: abs(f[0] - centers[k]))
            for k in order:
                if k not in used:
                    used.add(k)
                    cx[k, i], cy[k, i], op[k, i] = f[0], f[1], f[2]
                    break
    def ffill(a, default):
        a = a.copy()
        last = default
        for i in range(len(a)):
            if np.isnan(a[i]):
                a[i] = last
            else:
                last = a[i]
        return a
    for k in range(K):
        first = cx[k][~np.isnan(cx[k])]
        d = float(first[0]) if len(first) else centers[k]
        cx[k] = ffill(cx[k], d)
        fy = cy[k][~np.isnan(cy[k])]
        cy[k] = ffill(cy[k], float(fy[0]) if len(fy) else 0.4)
    w = max(int(round(1.2 / step)), 2)
    act_score = np.zeros((K, n))
    for k in range(K):
        for i in range(n):
            seg = op[k, max(0, i - w // 2): i + w // 2 + 1]
            seg = seg[~np.isnan(seg)]
            act_score[k, i] = float(np.std(seg)) if len(seg) > 1 else 0.0
    act, cur, pend, pend_n = [], 0, None, 0
    hold = max(int(round(0.7 / step)), 1)
    for i in range(n):
        best = int(np.argmax(act_score[:, i]))
        if best != cur and act_score[best, i] > 1.4 * act_score[cur, i] + 1e-4:
            if pend == best:
                pend_n += 1
            else:
                pend, pend_n = best, 1
            if pend_n >= hold:
                cur, pend, pend_n = best, None, 0
        else:
            pend, pend_n = None, 0
        act.append(cur)
    # quien esta hablando en cada muestra (movimiento de boca relativo al mas activo)
    allv = act_score[act_score > 0]
    ref_v = float(np.percentile(allv, 90)) if len(allv) else 0.0
    spk_thr = max(0.30 * ref_v, 0.008)
    spk = [[1 if act_score[k, i] > spk_thr else 0 for i in range(n)] for k in range(K)]
    a = 0.35
    for k in range(K):
        for i in range(1, n):
            cx[k, i] = cx[k, i - 1] + a * (cx[k, i] - cx[k, i - 1])
            cy[k, i] = cy[k, i - 1] + a * (cy[k, i] - cy[k, i - 1])
    return {"W": W, "H": H, "K": K, "p2": round(p2, 2), "t": [round(s[0], 3) for s in samples], "spk": spk,
            "cx": [[round(float(x), 4) for x in cx[k]] for k in range(K)],
            "cy": [[round(float(x), 4) for x in cy[k]] for k in range(K)], "act": act}

def do_energy(params, jobs):
    step = float(params.get("step", 0.25))
    sr = 16000
    win = max(int(sr * step), 1)
    out = {}
    for i, j in enumerate(jobs):
        try:
            audio, base = load_audio(j["path"], j["start"], j["end"])
            m = len(audio) // win
            if m < 1:
                out[j["id"]] = {"base": round(base, 3), "step": step, "db": []}
                continue
            x = audio[: m * win].astype(np.float32).reshape(m, win)
            rms = np.sqrt((x * x).mean(axis=1)) / 32768.0
            db = np.maximum(20.0 * np.log10(np.maximum(rms, 1e-9)), -80.0)
            out[j["id"]] = {"base": round(base, 3), "step": step, "db": [round(float(v), 1) for v in db]}
        except Exception as e:
            out[j["id"]] = {"error": str(e)[:200]}
        progress((i + 1) / len(jobs))
    return out

def do_mouth(params, jobs):
    import av
    import mediapipe as mp
    step = float(params.get("step", 0.15))
    out = {}
    for ji, j in enumerate(jobs):
        try:
            c = av.open(j["path"])
            v = c.streams.video[0]
            v.thread_type = "AUTO"
            try:
                v.codec_context.skip_frame = "NONREF"
            except Exception:
                pass
            W, H = v.codec_context.width, v.codec_context.height
            start, end = j["start"], j["end"]
            if start > 1.0:
                c.seek(int((start - 1.0) * 1000000), stream=v)
            fm = mp.solutions.face_mesh.FaceMesh(static_image_mode=False, max_num_faces=2,
                                                 refine_landmarks=False, min_detection_confidence=0.5,
                                                 min_tracking_confidence=0.5)
            h2 = max(int(480 * H / float(W)) // 2 * 2, 2)
            ts, op, nxt = [], [], start
            dur = max(end - start, 0.1)
            for frame in c.decode(v):
                if frame.time is None:
                    continue
                t = float(frame.time)
                if t < start or t < nxt:
                    continue
                if t > end:
                    break
                nxt = t + step
                img = frame.reformat(width=480, height=h2, format="rgb24").to_ndarray()
                res = fm.process(np.ascontiguousarray(img))
                best, bh = None, 0.0
                for fl in (res.multi_face_landmarks or []):
                    lm = fl.landmark
                    fh = abs(lm[152].y - lm[10].y)
                    if fh > bh:
                        bh, best = fh, abs(lm[14].y - lm[13].y) / max(fh, 1e-4)
                ts.append(t)
                op.append(best)
                progress((ji + min((t - start) / dur, 1.0)) / len(jobs))
            c.close()
            fm.close()
            n = len(ts)
            arr = np.array([(x if x is not None else np.nan) for x in op], dtype=np.float64)
            face = float(np.mean(~np.isnan(arr))) if n else 0.0
            w = max(int(round(0.9 / step)), 3)
            act = []
            for i in range(n):
                seg = arr[max(0, i - w // 2): i + w // 2 + 1]
                seg = seg[~np.isnan(seg)]
                act.append(round(float(np.std(seg)), 4) if len(seg) > 2 else 0.0)
            out[j["id"]] = {"t": [round(x, 3) for x in ts], "a": act, "face": round(face, 2)}
        except Exception as e:
            out[j["id"]] = {"error": str(e)[:200]}
        progress((ji + 1) / len(jobs))
    return out

if __name__ == "__main__":
    cmd, jf = sys.argv[1], sys.argv[2]
    data = json.load(open(jf, encoding="utf-8"))
    fn = {"transcribe": do_transcribe, "silence": do_silence, "reframe": do_reframe, "energy": do_energy, "mouth": do_mouth}[cmd]
    print(json.dumps(fn(data.get("params", {}), data["jobs"]), ensure_ascii=True))
