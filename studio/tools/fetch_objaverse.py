#!/usr/bin/env python3
"""Downloads the Objaverse models listed in tools/objaverse.json into .cache/raw/models/<id>/<id>.glb.

Objaverse (https://huggingface.co/datasets/allenai/objaverse) mirrors Sketchfab uploads with their licences; every
model used here is CC BY 4.0 (author and source in tools/objaverse.json, credited in README.md). Then run
`node tools/build_assets.mjs --models <ids>`.
"""
import gzip, json, os, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HF = 'https://huggingface.co/datasets/allenai/objaverse/resolve/main/'
UA = {'User-Agent': 'cuby-studio-asset-fetch'}


def main():
    models = json.load(open(os.path.join(ROOT, 'tools', 'objaverse.json')))
    cache = os.path.join(ROOT, '.cache', 'raw')
    paths_file = os.path.join(cache, 'objaverse-object-paths.json.gz')
    if not os.path.exists(paths_file):
        os.makedirs(cache, exist_ok=True)
        open(paths_file, 'wb').write(urllib.request.urlopen(urllib.request.Request(HF + 'object-paths.json.gz', headers=UA)).read())
    paths = json.load(gzip.open(paths_file))
    for mid, m in models.items():
        dst = os.path.join(cache, 'models', mid, f'{mid}.glb')
        if os.path.exists(dst):
            continue
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        data = urllib.request.urlopen(urllib.request.Request(HF + paths[m['uid']], headers=UA), timeout=300).read()
        open(dst, 'wb').write(data)
        print(f'{mid}: {len(data) / 1e6:.1f} MB ({m["author"]}, {m["license"]})')


if __name__ == '__main__':
    main()
