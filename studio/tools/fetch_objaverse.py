#!/usr/bin/env python3
"""Download the Objaverse models listed in tools/objaverse.json, optionally limited to the IDs passed on the command line.

Objaverse (https://huggingface.co/datasets/allenai/objaverse) mirrors Sketchfab uploads with their licences; every
model used here is CC BY 4.0 (author and source in tools/objaverse.json). Then run
`node tools/build_assets.mjs --models <ids>`.
"""
import gzip
import json
import os
import shutil
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HF = 'https://huggingface.co/datasets/allenai/objaverse/resolve/main/'
UA = {'User-Agent': 'cuby-studio-asset-fetch'}


def main():
    with open(os.path.join(ROOT, 'tools', 'objaverse.json'), encoding='utf-8') as source:
        models = json.load(source)
    wanted = sys.argv[1:] or list(models)
    for mid in wanted:
        if mid not in models:
            raise SystemExit(f'Unknown Objaverse model: {mid}')
    cache = os.environ.get('CUBY_ASSET_CACHE', os.path.join(ROOT, '.cache', 'raw'))
    paths_file = os.path.join(cache, 'objaverse-object-paths.json.gz')
    if not os.path.exists(paths_file):
        os.makedirs(cache, exist_ok=True)
        download(HF + 'object-paths.json.gz', paths_file)
    with gzip.open(paths_file, 'rt') as source:
        paths = json.load(source)
    for mid in wanted:
        m = models[mid]
        dst = os.path.join(cache, 'models', mid, f'{mid}.glb')
        if os.path.exists(dst):
            continue
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        download(HF + paths[m['uid']], dst)
        print(f'{mid}: {os.path.getsize(dst) / 1e6:.1f} MB ({m["author"]}, {m["license"]})')


def download(url, dest):
    temp = dest + '.part'
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as source, open(temp, 'wb') as output:
        shutil.copyfileobj(source, output)
    os.replace(temp, dest)


if __name__ == '__main__':
    main()
