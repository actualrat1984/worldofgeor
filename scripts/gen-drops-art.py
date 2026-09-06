"""Generate Lore Drops banner art via OpenRouter Nano Banana 2. One banner per card kind + hero. Anime style, slate/amber-friendly. Outputs JPG (model returns JPEG)."""
import base64
import json
import os
import sys
import urllib.request

ENV_PATH = os.path.expanduser('~/AppData/Local/hermes/.env')
OUT_DIR = 'C:/Users/pc/Documents/worldofgeor/public/drops-art'


def get_key():
    with open(ENV_PATH, 'r') as f:
        for line in f:
            if line.startswith('OPENROUTER_API_KEY='):
                return line.strip().split('=', 1)[1].strip('"\'')
    raise RuntimeError('OPENROUTER_API_KEY not found')


BANNERS = {
    'nation': 'wide anime landscape of a small walled fantasy city at golden hour beneath a pale silver ring arcing across the sky, banners on towers, cinematic, clean linework, soft shading, high quality anime illustration',
    'culture': 'warm anime scene of a night market festival street with lanterns and dancers in folk dress, food stalls and music, cozy golden light, clean linework, soft shading, high quality anime illustration',
    'orphan': 'lonely anime scene of a tattered banner on a stone beacon in silver mist, a single lit lantern, melancholic and quiet, clean linework, soft shading, high quality anime illustration',
    'map': 'anime style cartographer desk from above with ink coastlines being drawn on parchment, compass rose and brass instruments, candlelight, clean linework, soft shading, high quality anime illustration',
    'age': 'epic anime vista of colossal ancient ruins half-buried across a valley at dusk, tiny traveler silhouette, deep time feeling, clean linework, soft shading, high quality anime illustration',
    'count': 'grand anime archive hall with towering shelves of scrolls and a hooded keeper with a ledger, shafts of amber light, clean linework, soft shading, high quality anime illustration',
    'hero': 'breathtaking anime panorama of a ringed fantasy planet rising over mountain peaks at dawn, silver ring horizon to horizon, small birds in flight, clean linework, soft shading, high quality anime illustration',
}


def generate(key, name, prompt):
    body = json.dumps({
        'model': 'google/gemini-3.1-flash-image',
        'messages': [{'role': 'user', 'content': [{'type': 'text',
                     'text': 'Generate a high-quality illustration: ' + prompt}]}],
        'modalities': ['image', 'text'],
        'max_tokens': 4096,
    }).encode('utf-8')
    req = urllib.request.Request(
        'https://openrouter.ai/api/v1/chat/completions', data=body,
        headers={'Authorization': 'Bearer ' + key,
                 'Content-Type': 'application/json',
                 'HTTP-Referer': 'https://hermes.local',
                 'X-Title': 'worldofgeor-drops-art'})
    with urllib.request.urlopen(req, timeout=180) as resp:
        data = json.loads(resp.read().decode('utf-8'))
    images = data['choices'][0]['message'].get('images') or []
    if not images:
        return (name, False, 'no images in response: ' + json.dumps(data)[:200])
    url = images[0]['image_url']['url']
    if not url.startswith('data:image/'):
        return (name, False, 'non-data url')
    mime = url.split(';', 1)[0]
    ext = 'png' if mime.endswith('png') else 'jpg'
    raw = base64.b64decode(url.split(',', 1)[1])
    path = os.path.join(OUT_DIR, name + '.' + ext)
    with open(path, 'wb') as f:
        f.write(raw)
    cost = (data.get('usage') or {}).get('cost', '?')
    return (name, True, path + ' (%d bytes, cost %s)' % (len(raw), cost))


def main():
    only = sys.argv[1:] or list(BANNERS)
    os.makedirs(OUT_DIR, exist_ok=True)
    key = get_key()
    for name in only:
        if name not in BANNERS:
            print('skip unknown ' + name, flush=True)
            continue
        try:
            n, ok, info = generate(key, 'drops-' + name, BANNERS[name])
            print(('OK ' if ok else 'FAIL ') + n + ' -> ' + info, flush=True)
        except Exception as e:
            print('FAIL ' + name + ' -> ' + repr(e)[:200], flush=True)


if __name__ == '__main__':
    main()
