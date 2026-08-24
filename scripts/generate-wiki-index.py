import pathlib, json, re
wiki = pathlib.Path(r"C:/Users/pc/Documents/worldofgeor/dist/wiki")
if not wiki.exists():
    print("wiki not built yet, skip index")
    exit(0)
entries=[]
for html in wiki.rglob("index.html"):
    parent = str(html.relative_to(wiki).parent).replace("\\", "/")
    url = "/wiki/" + parent + "/" if parent != "." else "/wiki/"
    title = "Home" if parent == "." else html.relative_to(wiki).parent.name.replace("%20"," ").replace("_"," ")
    try:
        txt = html.read_text(encoding="utf-8", errors="ignore")
        m = re.search(r"<h1[^>]*>(.*?)</h1>", txt, re.S)
        if m:
            t = re.sub(r"<[^>]+>", "", m.group(1)).replace("¶","").replace("&para;","").strip()
            if t and len(t)<80:
                title = t
    except: pass
    entries.append({"url": url, "title": title})
entries = sorted(entries, key=lambda x: x["title"].lower())
out = pathlib.Path(r"C:/Users/pc/Documents/worldofgeor/dist/wiki-index.json")
out.write_text(json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8")
pub = pathlib.Path(r"C:/Users/pc/Documents/worldofgeor/public/wiki-index.json")
pub.write_text(json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"wiki-index {len(entries)} entries -> {out} {out.stat().st_size} bytes")
