#!/usr/bin/env python3
# Generatore v3: SVG collegati alle variabili del CSS centrale.
from __future__ import annotations
from pathlib import Path
import argparse, html, json, math, os, re, sys
from typing import Any

FILES={"master":"centro_master.json","food":"01_alimentazione.json","places":"02_provenienze.json","settlement":"03_insediamento.json","building":"04_costruzione.json","knowledge":"05_conoscenze.json","claims":"06_fonti_certezza.json"}
PAGES=[("01_alimentazione.html","Alimentazione","Grafo stratificato","territorio → alimento → acquisizione → trasformazione → prodotto"),("02_provenienze.html","Provenienze","Mappa a flussi","approvvigionamento locale, regionale e connessioni lontane"),("03_insediamento.html","Insediamento","Timeline a corsie","fasi cronologiche e funzioni delle strutture"),("04_costruzione.html","Costruzione","Grafo di processo","materia prima → operazione → componente → struttura"),("05_conoscenze.html","Conoscenze","Albero radiale","competenze ambientali, tecniche e sociali"),("06_fonti_certezza.html","Fonti e certezza","Matrice di controllo","affermazioni, stato della verifica e fonti")]

def esc(x:Any)->str:return html.escape(str(x),quote=True)
def load(p:Path)->Any:return json.loads(p.read_text(encoding='utf-8'))
def rel(a:Path,b:Path)->str:return Path(os.path.relpath(b,a)).as_posix()
def require(d:Path):
    m=[v for v in FILES.values() if not (d/v).exists()]
    if m:raise FileNotFoundError('File JSON mancanti: '+', '.join(m))
def statuses(master):return master.get('status',{})
def stmap(sts,key):
    s=sts.get(key,{})
    return {'label':s.get('label',key),'color':s.get('color','#8b8f97'),'dash':s.get('dash',''),'opacity':s.get('opacity',1)}
def wrap(text,maxc=27,maxl=3):
    words=str(text).split();lines=[];cur=''
    for w in words:
        p=w if not cur else cur+' '+w
        if len(p)<=maxc or not cur:cur=p
        else:lines.append(cur);cur=w
    if cur:lines.append(cur)
    if len(lines)>maxl:
        lines=lines[:maxl];lines[-1]=lines[-1][:maxc-1].rstrip()+'…'
    return lines or ['']
def textlines(x,y,text,maxc=27,fs=12,weight=600,fill='var(--ink)',maxl=3):
    lines=wrap(text,maxc,maxl);lh=fs+4;start=y-(len(lines)-1)*lh/2
    ts=''.join(f'<tspan x="{x:.1f}" y="{start+i*lh:.1f}">{esc(t)}</tspan>' for i,t in enumerate(lines))
    return f'<text text-anchor="middle" dominant-baseline="middle" font-size="{fs}" font-weight="{weight}" fill="{fill}">{ts}</text>'
def defs():return '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"/></marker><filter id="shadow"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity=".18"/></filter></defs>'
def legend(sts):
    out=[]
    for k in ['documentato','sintesi','inferito','non_documentato']:
        s=stmap(sts,k);dash='border-top-style:dashed;' if s['dash'] else ''
        out.append(f'<div class="legend-item"><span class="legend-line" style="border-color:{s["color"]};{dash}"></span>{esc(s["label"])}</div>')
    return '<div class="legend">'+''.join(out)+'</div>'
def controls():
    labs=[('all','Tutto'),('documentato','Documentato'),('sintesi','Sintesi da verificare'),('inferito','Inferito'),('non_documentato','Non documentato')]
    return '<div class="controls">'+''.join(f'<button data-status="{k}" class="{"active" if k=="all" else ""}" onclick="setStatus(\'{k}\')">{v}</button>' for k,v in labs)+'</div>'
def nav(cur):
    items=[('../../index.html','Macroregione','macro'),('../index.html','Centro','index')]+[(f,l,f) for f,l,_,_ in PAGES]
    return '<nav>'+''.join(f'<a href="{h}"{" aria-current=\"page\"" if cur==k else ""}>{esc(l)}</a>' for h,l,k in items)+'</nav>'
def shell(title,subtitle,cur,css,js,body):
    return f'<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{esc(title)}</title><link rel="stylesheet" href="{esc(css)}"><script defer src="{esc(js)}"></script></head><body><header><h1>{esc(title)}</h1><p>{esc(subtitle)}</p></header>{nav(cur)}<main>{body}</main></body></html>'
def intro(h,p,n,sts):
    note=f'<div class="note">{esc(n)}</div>' if n else ''
    return f'<div class="card intro"><div><h2>{esc(h)}</h2><p>{p}</p>{note}</div><div><h3>Attendibilità</h3>{legend(sts)}</div></div>'

def layered(data,sts,titles,height):
    nodes=data['nodes'];edges=data['edges'];layers=sorted({int(n['layer']) for n in nodes});W=1500;nw=225;nh=64;left=135;right=W-135;top=120;bottom=height-70
    xs={lay:left+i*((right-left)/max(1,len(layers)-1)) for i,lay in enumerate(layers)};pos={}
    for lay in layers:
        group=[n for n in nodes if int(n['layer'])==lay];ys=[(top+bottom)/2] if len(group)==1 else [top+i*((bottom-top)/(len(group)-1)) for i in range(len(group))]
        for n,y in zip(group,ys):pos[n['id']]=(xs[lay],y)
    p=[f'<svg viewBox="0 0 {W} {height}" role="img">',defs()]
    for i,t in enumerate(titles):
        if i in xs:p.append(f'<text x="{xs[i]:.1f}" y="42" text-anchor="middle" font-size="16" font-weight="700" fill="var(--forest)">{esc(t)}</text>')
    for e in edges:
        sx,sy=pos[e['source']];tx,ty=pos[e['target']];s=stmap(sts,e['status']);x1=sx+nw/2;x2=tx-nw/2;mid=(x1+x2)/2;dash=f' stroke-dasharray="{s["dash"]}"' if s['dash'] else ''
        p.append(f'<path class="edge" data-source="{esc(e["source"])}" data-target="{esc(e["target"])}" data-status="{esc(e["status"])}" d="M {x1:.1f} {sy:.1f} C {mid:.1f} {sy:.1f}, {mid:.1f} {ty:.1f}, {x2:.1f} {ty:.1f}" fill="none" stroke="{s["color"]}" stroke-width="2.3" opacity="{s["opacity"]}"{dash} marker-end="url(#arrow)"><title>{esc(e.get("label",""))} — {esc(s["label"])}</title></path>')
    for n in nodes:
        x,y=pos[n['id']];s=stmap(sts,n['status'])
        p.append(f'<g class="node" data-id="{esc(n["id"])}" data-status="{esc(n["status"])}"><title>{esc(n["label"])} — {esc(s["label"])}</title><rect x="{x-nw/2:.1f}" y="{y-nh/2:.1f}" width="{nw}" height="{nh}" rx="12" fill="var(--surface)" stroke="{s["color"]}" stroke-width="2" filter="url(#shadow)"/>{textlines(x,y,n["label"])}</g>')
    p.append('</svg>');return ''.join(p)

def provenance(data,sts):
    places=data['places'];flows=data['flows'];local=[p for p in places if p.get('kind')!='lungadistanza'];distant=[p for p in places if p.get('kind')=='lungadistanza'];W,H=1500,850;px0,py0,pw,ph=70,130,1090,590
    lats=[float(p['lat']) for p in local];lons=[float(p['lon']) for p in local];latpad=max(.08,(max(lats)-min(lats))*.18);lonpad=max(.12,(max(lons)-min(lons))*.12);latmin,latmax=min(lats)-latpad,max(lats)+latpad;lonmin,lonmax=min(lons)-lonpad,max(lons)+lonpad
    def proj(p):return (px0+(float(p['lon'])-lonmin)/(lonmax-lonmin)*pw,py0+(latmax-float(p['lat']))/(latmax-latmin)*ph)
    pos={p['id']:proj(p) for p in local};p=[f'<svg viewBox="0 0 {W} {H}" role="img">',defs(),f'<rect x="{px0}" y="{py0}" width="{pw}" height="{ph}" rx="18" fill="var(--surface)" stroke="var(--line)"/>']
    for i in range(1,5):
        x=px0+i*pw/5;lon=lonmin+i*(lonmax-lonmin)/5;p+= [f'<line x1="{x:.1f}" y1="{py0}" x2="{x:.1f}" y2="{py0+ph}" stroke="var(--line)"/>',f'<text x="{x:.1f}" y="{py0+ph+22}" text-anchor="middle" font-size="11" fill="var(--ink)">{abs(lon):.2f}°{'E' if lon >= 0 else 'W'}</text>']
    for i in range(1,4):
        y=py0+i*ph/4;lat=latmax-i*(latmax-latmin)/4;p += [f'<line x1="{px0}" y1="{y:.1f}" x2="{px0+pw}" y2="{y:.1f}" stroke="var(--line)"/>',f'<text x="{px0-12}" y="{y:.1f}" text-anchor="end" dominant-baseline="middle" font-size="11" fill="var(--ink)">{lat:.2f}°N</text>']
    p += ['<text x="615" y="88" text-anchor="middle" font-size="18" font-weight="700" fill="var(--forest)">Territori di approvvigionamento — coordinate moderne indicative</text>','<rect x="1200" y="92" width="270" height="195" rx="16" fill="var(--paper)" stroke="var(--line)"/>','<text x="1335" y="116" text-anchor="middle" font-size="13" font-weight="700" fill="var(--ink)">Connessioni a lunga distanza</text>']
    dpos={}
    for i,q in enumerate(distant):
        x,y=1335,160+i*74;dpos[q['id']]=(x,y);s=stmap(sts,q['status']);p.append(f'<g class="node" data-id="{esc(q["id"])}" data-status="{esc(q["status"])}"><circle cx="{x}" cy="{y}" r="9" fill="#fff" stroke="{s["color"]}" stroke-width="3"/>{textlines(x,y+31,q["label"],30,11,600,"var(--ink)",3)}</g>')
    apos={**pos,**dpos}
    for f in flows:
        if f['source'] not in apos or f['target'] not in apos:continue
        sx,sy=apos[f['source']];tx,ty=apos[f['target']];s=stmap(sts,f['status']);dash=f' stroke-dasharray="{s["dash"]}"' if s['dash'] else ''
        d=f'M {sx-12:.1f} {sy:.1f} C 1165 {sy:.1f}, 1145 {ty:.1f}, {tx:.1f} {ty:.1f}' if f['source'] in dpos else f'M {sx:.1f} {sy:.1f} Q {(sx+tx)/2:.1f} {min(sy,ty)-55:.1f} {tx:.1f} {ty:.1f}'
        p.append(f'<path class="edge" data-source="{esc(f["source"])}" data-target="{esc(f["target"])}" data-status="{esc(f["status"])}" d="{d}" fill="none" stroke="{s["color"]}" stroke-width="3" opacity="{s["opacity"]}"{dash} marker-end="url(#arrow)"><title>{esc(f.get("label",""))}; alimenti: {esc(f.get("food",""))}</title></path>')
    for q in local:
        x,y=pos[q['id']];s=stmap(sts,q['status']);r=11 if q.get('kind')=='centro' else 8;fill=s['color'] if q.get('kind')=='centro' else 'var(--surface)'
        p.append(f'<g class="node" data-id="{esc(q["id"])}" data-status="{esc(q["status"])}"><title>{esc(q["label"])} — {esc(s["label"])}</title><circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="{fill}" stroke="{s["color"]}" stroke-width="3"/><text x="{x+float(q.get("dx",0)):.1f}" y="{y+float(q.get("dy",24)):.1f}" text-anchor="{esc(q.get("anchor","middle"))}" font-size="12" font-weight="600" fill="var(--ink)">{esc(q["label"])}</text></g>')
    p.append('</svg>');return ''.join(p)

def timeline(data,sts):
    phases=data['phases'];items=data['items'];lanes=[]
    for i in items:
        if i['lane'] not in lanes:lanes.append(i['lane'])
    W=1500;H=max(760,205+len(lanes)*88);left,right,top=245,60,145;pw=(W-left-right)/len(phases);lh=(H-top-45)/len(lanes);p=[f'<svg viewBox="0 0 {W} {H}" role="img">',defs()]
    for i,phase in enumerate(phases):
        x=left+i*pw;fill='var(--surface)' if i%2==0 else 'var(--paper)';p += [f'<rect x="{x:.1f}" y="{top}" width="{pw:.1f}" height="{H-top-35}" fill="{fill}" stroke="var(--line)"/>',f'<text x="{x+pw/2:.1f}" y="76" text-anchor="middle" font-size="18" font-weight="700" fill="var(--forest)">{esc(phase)}</text>']
    for i,lane in enumerate(lanes):
        cy=top+(i+.5)*lh;p += [f'<text x="{left-18}" y="{cy:.1f}" text-anchor="end" dominant-baseline="middle" font-size="13" font-weight="700" fill="var(--muted)">{esc(lane)}</text>',f'<line x1="{left}" y1="{top+(i+1)*lh:.1f}" x2="{W-right}" y2="{top+(i+1)*lh:.1f}" stroke="var(--line)"/>']
    for it in items:
        li=lanes.index(it['lane']);cy=top+(li+.5)*lh;x1=left+int(it['start'])*pw+18;x2=left+(int(it['end'])+1)*pw-18;hh=min(57,lh-18);s=stmap(sts,it['status'])
        p.append(f'<g class="node" data-id="{esc(it["id"])}" data-status="{esc(it["status"])}"><title>{esc(it["label"])} — {esc(s["label"])}</title><rect x="{x1:.1f}" y="{cy-hh/2:.1f}" width="{x2-x1:.1f}" height="{hh:.1f}" rx="11" fill="#fff" stroke="{s["color"]}" stroke-width="2" filter="url(#shadow)"/>{textlines((x1+x2)/2,cy,it["label"],max(22,int((x2-x1)/8)),12)}</g>')
    p.append('</svg>');return ''.join(p)

def knowledge(data,sts):
    W,H=1500,1100;cx,cy=W/2,H/2;cats=data.get('children',[]);r1,r2=210,410
    leaves=[(c,ch) for c in cats for ch in c.get('children',[])]
    if not cats or not leaves:return '<svg viewBox="0 0 1500 1100"></svg>'
    leafang={ch['id']:-math.pi/2+i*2*math.pi/len(leaves) for i,(_,ch) in enumerate(leaves)};catang={}
    for c in cats:
        aa=[leafang[ch['id']] for ch in c.get('children',[])];sx=sum(math.cos(a) for a in aa);sy=sum(math.sin(a) for a in aa);catang[c['id']]=math.atan2(sy,sx)
    pos={data['id']:(cx,cy)}
    for c in cats:
        a=catang[c['id']];pos[c['id']]=(cx+r1*math.cos(a),cy+r1*math.sin(a))
        for ch in c.get('children',[]):
            a=leafang[ch['id']];pos[ch['id']]=(cx+r2*math.cos(a),cy+r2*math.sin(a))
    nodes=[];edges=[]
    def walk(n,parent=None,depth=0):
        z=dict(n);z['_depth']=depth;nodes.append(z)
        if parent:edges.append((parent,n['id']))
        for ch in n.get('children',[]):walk(ch,n['id'],depth+1)
    walk(data);by={n['id']:n for n in nodes};p=[f'<svg class="knowledge-radial" viewBox="0 0 {W} {H}" role="img" style="font-family:Georgia,\'Times New Roman\',serif">',defs()]
    for a,b in edges:
        sx,sy=pos[a];tx,ty=pos[b];s=stmap(sts,by[b]['status']);dash=f' stroke-dasharray="{s["dash"]}"' if s['dash'] else ''
        p.append(f'<path class="edge" data-source="{esc(a)}" data-target="{esc(b)}" data-status="{esc(by[b]["status"])}" d="M {sx:.1f} {sy:.1f} Q {cx:.1f} {cy:.1f} {tx:.1f} {ty:.1f}" fill="none" stroke="{s["color"]}" stroke-width="2.2" opacity="{s["opacity"]}"{dash}><title>{esc(by[a]["label"])} → {esc(by[b]["label"])}</title></path>')
    root=nodes[0];s=stmap(sts,root['status']);p.append(f'<g class="node" data-id="{esc(root["id"])}" data-status="{esc(root["status"])}"><circle cx="{cx}" cy="{cy}" r="82" fill="var(--forest)" stroke="{s["color"]}" stroke-width="2" filter="url(#shadow)"/>{textlines(cx,cy,root["label"],22,16,700,"#fff",3)}</g>')
    for c in cats:
        x,y=pos[c['id']];s=stmap(sts,c['status']);p.append(f'<g class="node" data-id="{esc(c["id"])}" data-status="{esc(c["status"])}"><title>{esc(c["label"])} — {esc(s["label"])}</title><circle cx="{x:.1f}" cy="{y:.1f}" r="55" fill="var(--paper)" stroke="{s["color"]}" stroke-width="3" filter="url(#shadow)"/>{textlines(x,y,c["label"],19,12,700,"var(--ink)",3)}</g>')
    for c,ch in leaves:
        x,y=pos[ch['id']];s=stmap(sts,ch['status']);anchor='start' if x>=cx else 'end';dx=14 if anchor=='start' else -14
        p.append(f'<g class="node" data-id="{esc(ch["id"])}" data-status="{esc(ch["status"])}"><title>{esc(ch["label"])} — {esc(s["label"])}</title><circle cx="{x:.1f}" cy="{y:.1f}" r="9" fill="#fff" stroke="{s["color"]}" stroke-width="3"/><text x="{x+dx:.1f}" y="{y:.1f}" text-anchor="{anchor}" dominant-baseline="middle" font-size="12" font-weight="600" fill="var(--ink)">{esc(ch["label"])}</text></g>')
    p.append('</svg>');return ''.join(p)

def claims_table(rows,sts):
    out=[]
    for r in rows:
        s=stmap(sts,r['status']);src=r.get('source',r.get('source_or_action',''));out.append(f'<tr data-status="{esc(r["status"])}"><td>{esc(r["claim"])}</td><td>{esc(r["theme"])}</td><td><span class="tag" style="border-color:{s["color"]};color:{s["color"]}">{esc(s["label"])}</span></td><td>{esc(src)}</td></tr>')
    return '<table><thead><tr><th>Affermazione</th><th>Tema</th><th>Stato</th><th>Fonte / azione</th></tr></thead><tbody>'+''.join(out)+'</tbody></table>'
def sources(master):
    return '<div class="source-list">'+''.join(f'<div class="source-item"><strong>{esc(s["id"])}</strong> — {esc(s["title"])}<br><span>{esc(s.get("use",""))}</span><br><a href="{esc(s.get("url","#"))}">{esc(s.get("url","#"))}</a></div>' for s in master.get('sources',[]))+'</div>'

def generate(data_dir:Path,out:Path,root:Path):
    require(data_dir);master=load(data_dir/FILES['master']);sts=statuses(master);meta=master['meta'];display=meta.get('short_name') or meta.get('site','Centro').split('/')[0].strip();docs=out/'documenti';docs.mkdir(parents=True,exist_ok=True);cssc=rel(out,root/'assets'/'style.css');jsc=rel(out,root/'assets'/'interactions.js');cssd=rel(docs,root/'assets'/'style.css');jsd=rel(docs,root/'assets'/'interactions.js')
    cards=''.join(f'<a class="link-card" href="documenti/{f}"><span class="small">{i:02d} · {esc(k)}</span><strong>{esc(l)}</strong><p>{esc(d)}</p></a>' for i,(f,l,k,d) in enumerate(PAGES,1))
    body=f'<div class="card intro"><div><h2>Modulo generato da JSON</h2><p>Le sei visualizzazioni sono prodotte automaticamente dai file nella cartella <code>dati</code>. Modificando i JSON e avviando <code>RIGENERA_CENTRO.bat</code>, le pagine vengono ricostruite.</p><div class="note">{esc(meta.get("warning",""))}</div></div><div><h3>Localizzazione</h3><p><strong>{esc(meta.get("site",""))}</strong><br>{esc(meta.get("modern_location",""))}<br>{esc(abs(float(meta.get("coordinates",{}).get("lat",0))))} {'N' if float(meta.get("coordinates",{}).get("lat",0)) >= 0 else 'S'}, {esc(abs(float(meta.get("coordinates",{}).get("lon",0))))} {'E' if float(meta.get("coordinates",{}).get("lon",0)) >= 0 else 'W'}</p></div></div><div class="card"><h2>Documenti</h2><div class="cards">{cards}</div></div><div class="card"><h2>Metadati</h2><div class="meta-grid"><div class="meta-box"><strong>Ambito</strong><br>{esc(meta.get("scope",""))}</div><div class="meta-box"><strong>Versione dati</strong><br>{esc(meta.get("version",""))}</div><div class="meta-box"><strong>Fonti registrate</strong><br>{len(master.get("sources",[]))}</div></div></div><div class="card"><h2>File dati canonici</h2><pre>{esc(chr(10).join(FILES.values()))}</pre></div>'
    index=f'<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{esc(display)} — modulo multi-grafo JSON</title><link rel="stylesheet" href="{cssc}"><script defer src="{jsc}"></script></head><body><header><h1>{esc(display)} — modulo multi-grafo JSON</h1><p>{esc(meta.get("scope",""))}</p></header><nav><a href="../index.html">Macroregione</a><a href="index.html" aria-current="page">Centro</a>{"".join(f"<a href=\"documenti/{f}\">{esc(l)}</a>" for f,l,_,_ in PAGES)}</nav><main>{body}</main></body></html>'
    (out/'index.html').write_text(index,encoding='utf-8');made=[out/'index.html']
    food=load(data_dir/FILES['food']);b=intro('Perché un grafo stratificato','La domanda alimentare richiede una catena leggibile: <strong>territorio → alimento → acquisizione → trasformazione → prodotto o evidenza</strong>.','Le identificazioni incerte restano separate dai dati documentati e dalle inferenze.',sts)+f'<div class="card"><h2>Catene alimentari</h2>{controls()}<div class="graph-wrap">{layered(food,sts,["Territorio","Alimenti / risorse","Acquisizione","Trasformazione","Prodotti / evidenze"],920)}</div></div>';p=docs/'01_alimentazione.html';p.write_text(shell(f'{display} — Alimentazione','Grafo stratificato delle risorse alimentari, delle modalità di acquisizione e delle trasformazioni.','01_alimentazione.html',cssd,jsd,b),encoding='utf-8');made.append(p)
    places=load(data_dir/FILES['places']);b=intro('Perché una mappa a flussi','La provenienza è una proprietà geografica. La mappa distingue approvvigionamento locale, hinterland regionale e connessioni lontane.','La presenza di materiali esotici non dimostra automaticamente il commercio di alimenti.',sts)+f'<div class="card"><h2>Territori di approvvigionamento</h2>{controls()}<div class="graph-wrap">{provenance(places,sts)}</div></div>';p=docs/'02_provenienze.html';p.write_text(shell(f'{display} — Provenienze','Mappa geografica a flussi con coordinate e toponimi moderni.','02_provenienze.html',cssd,jsd,b),encoding='utf-8');made.append(p)
    sett=load(data_dir/FILES['settlement']);b=intro('Perché una timeline a corsie','Le tipologie insediative devono essere collegate a fasi specifiche. Le corsie separano funzioni abitative, comunitarie, produttive, funerarie e periferiche.','Le durate sono schematiche e non sostituiscono una cronologia stratigrafica completa.',sts)+f'<div class="card"><h2>Evoluzione delle forme insediative</h2>{controls()}<div class="graph-wrap">{timeline(sett,sts)}</div></div>';p=docs/'03_insediamento.html';p.write_text(shell(f'{display} — Tipologie insediative','Timeline a corsie per distinguere fasi, forme e funzioni.','03_insediamento.html',cssd,jsd,b),encoding='utf-8');made.append(p)
    build=load(data_dir/FILES['building']);b=intro('Perché un grafo di processo','La tecnica costruttiva viene scomposta in quattro livelli: <strong>materia prima → operazione → componente → struttura</strong>.','Il modello distingue materiali, lavorazioni, componenti edilizi e risultati architettonici.',sts)+f'<div class="card"><h2>Catene costruttive</h2>{controls()}<div class="graph-wrap">{layered(build,sts,["Materia prima","Operazione tecnica","Componente edilizio","Struttura / risultato"],820)}</div></div>';p=docs/'04_costruzione.html';p.write_text(shell(f'{display} — Tecniche costruttive','Grafo di processo dai materiali alle strutture.','04_costruzione.html',cssd,jsd,b),encoding='utf-8');made.append(p)
    know=load(data_dir/FILES['knowledge']);b=intro('Perché un albero radiale','Le conoscenze sono organizzate in famiglie parallele: ambiente, agricoltura, acqua, tecnologie, edilizia e coordinamento sociale.','Il termine conoscenza indica qui sapere empirico e operativo, non necessariamente scienza formalizzata.',sts)+f'<div class="card"><h2>Gerarchia delle competenze</h2>{controls()}<div class="graph-wrap">{knowledge(know,sts)}</div></div>';p=docs/'05_conoscenze.html';p.write_text(shell(f'{display} — Conoscenze','Albero radiale delle competenze necessarie o documentate.','05_conoscenze.html',cssd,jsd,b),encoding='utf-8');made.append(p)
    cl=load(data_dir/FILES['claims']);b=intro('Perché una matrice di controllo','Questa vista controlla la qualità del modello: ogni affermazione è collegata a un tema, un livello di attendibilità e una fonte.','Le domande aperte restano visibili e non vengono colmate con dati inventati.',sts)+f'<div class="card"><h2>Affermazioni e stato della verifica</h2>{controls()}<div class="graph-wrap">{claims_table(cl,sts)}</div></div><div class="card"><h2>Repertorio delle fonti</h2>{sources(master)}</div>';p=docs/'06_fonti_certezza.html';p.write_text(shell(f'{display} — Fonti e certezza','Matrice di controllo delle affermazioni usate nei grafi.','06_fonti_certezza.html',cssd,jsd,b),encoding='utf-8');made.append(p)
    return made

def verify(data_dir,out,root):
    errors=[]
    try:
        require(data_dir)
        for f in FILES.values():load(data_dir/f)
    except Exception as e:errors.append('JSON: '+str(e))
    expected=[out/'index.html']+[out/'documenti'/p[0] for p in PAGES]
    for p in expected:
        if not p.exists():errors.append('Manca: '+str(p))
    for p in [root/'assets'/'style.css',root/'assets'/'interactions.js']:
        if not p.exists():errors.append('Manca: '+str(p))
    for page in [p for p in expected if p.exists()]:
        t=page.read_text(encoding='utf-8')
        for m in re.finditer(r'<path class="edge"[^>]+>',t):
            if 'fill="none"' not in m.group(0):errors.append('Arco SVG senza fill=none: '+str(page))
        for refx in re.findall(r'(?:href|src)="([^"]+)"',t):
            if refx.startswith(('http://','https://','#','mailto:','javascript:')):continue
            target=(page.parent/refx.split('#',1)[0].split('?',1)[0]).resolve()
            if not target.exists():errors.append(f'Collegamento mancante in {page.name}: {refx}')
    return errors

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--data',type=Path,required=True);ap.add_argument('--output',type=Path,required=True);ap.add_argument('--root',type=Path,required=True);ap.add_argument('--verify-only',action='store_true');a=ap.parse_args();d=a.data.resolve();o=a.output.resolve();r=a.root.resolve()
    if not a.verify_only:print('Pagine generate:',len(generate(d,o,r)))
    e=verify(d,o,r)
    if e:
        print('Verifica NON superata:',file=sys.stderr)
        for x in e:print(' -',x,file=sys.stderr)
        return 1
    print('Verifica superata: JSON, pagine, collegamenti e archi SVG sono coerenti.');return 0
if __name__=='__main__':raise SystemExit(main())
