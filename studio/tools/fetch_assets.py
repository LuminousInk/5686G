#!/usr/bin/env python3
"""Download the assets Cuby Studio uses into studio/.cache/raw/.

    python3 tools/fetch_assets.py            # everything
    python3 tools/fetch_assets.py teak_veneer boulder_01

Poly Haven and ambientCG assets are CC0. Model credits are in tools/model-credits.json.
Re-running skips files that are already complete.
Then run `node tools/build_assets.mjs` to turn them into the web-ready files in public/assets/.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request
from zipfile import ZipFile
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, '.cache', 'raw')
RAW = os.environ.get('CUBY_ASSET_CACHE', RAW)
API = 'https://api.polyhaven.com/files/'
UA = {'User-Agent': 'cuby-studio-asset-fetch/2.0'}
AMBIENT_LAWN = 'Grass001'
LAWN_ARCHIVE = f'{AMBIENT_LAWN}_1K-JPG.zip'

# id -> (kind, resolutions)
HDRIS = {
    'syferfontein_6d_clear_puresky': '1k,2k',        # golden hour (default)
    'kloofendal_48d_partly_cloudy_puresky': '1k,2k', # day
    'qwantani_dusk_2_puresky': '1k',                 # dusk
    'qwantani_moonrise_puresky': '1k',               # night
}
TEXTURES = {
    'teak_veneer': '1k,2k',            # cedar boards, decking (tinted per finish)
    'japanese_cedar_planks': '1k',     # soffits, wood ceilings
    'sparse_grass': '1k',              # lawn base under the grass blades
    'forest_ground_04': '1k',          # planting soil / mulch
    'mossy_rock': '1k',                # moss patches in the rock garden
    'ganges_river_pebbles': '1k',      # pebble border
    'black_painted_planks': '1k',      # fence
    'brushed_concrete': '1k',          # pavers, slabs
    'oak_wood_planks': '1k',           # wide oak floor
    'wood_floor': '1k',                # walnut floor (tinted)
    'wood_planks_grey': '1k',          # ash floor
    'white_oak_veneer': '1k',          # cabinets
    'natural_walnut_veneer': '1k',
    'ash_veneer': '1k',
    'rough_linen': '1k',               # upholstery, bedding
    'withered_grass': '1k',            # dry summer grasses on coastal slopes
    'gravelly_sand': '1k',            # compacted decomposed-granite proxy
    'coast_sand_rocks_02': '1k',       # sedimentary outcrops and bluffs
    'wood_chip_path': '1k',            # bark-mulched garden beds
}
AMBIENT_CG = {
    'ambientcg_marble019': 'Marble019',
    'ambientcg_tiles142': 'Tiles142',
    'ambientcg_plaster001': 'Plaster001',
}
TEX_MAPS = ('Diffuse', 'nor_gl', 'arm')
COASTAL_SURFACES = {'withered_grass', 'wood_chip_path', 'gravelly_sand', 'coast_sand_rocks_02'}
with open(os.path.join(ROOT, 'tools', 'model-credits.json'), encoding='utf-8') as manifest:
    MODEL_CREDITS = json.load(manifest)
# Rock-garden models for the site, plus every Poly Haven model credited in tools/model-credits.json.
SITE_MODELS = [
    'boulder_01', 'rock_moss_set_01', 'rock_moss_set_02', 'namaqualand_boulder_02', 'namaqualand_boulders_01',
    'stone_01', 'rock_07', 'rock_09', 'fern_02', 'shrub_04', 'shrub_03', 'grass_medium_01',
]
MODELS = list(dict.fromkeys(SITE_MODELS + [asset for asset, credit in MODEL_CREDITS.items() if credit['provider'] == 'Poly Haven']))
KHRONOS = [asset for asset, credit in MODEL_CREDITS.items() if credit['provider'] == 'Khronos']
KHRONOS_URL = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/{0}/glTF-Binary/{0}.glb'


def get_json(url: str) -> dict:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return json.load(r)


def download(url: str, dest: str, size: int | None) -> str:
    if os.path.exists(dest) and (size is None or os.path.getsize(dest) == size):
        return f'cached {os.path.relpath(dest, RAW)}'
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + '.part'
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=600) as r, open(tmp, 'wb') as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    os.replace(tmp, dest)
    return f'got    {os.path.relpath(dest, RAW)} ({os.path.getsize(dest) / 1e6:.1f} MB)'


def jobs_for(asset: str) -> list[tuple[str, str, int | None]]:
    if asset in AMBIENT_CG:
        bundle = f'{AMBIENT_CG[asset]}_1K-JPG'
        return [(f'https://ambientcg.com/get?file={bundle}.zip',
                 os.path.join(RAW, 'ambientcg', f'{bundle}.zip'), None)]
    if asset in KHRONOS:
        return [(KHRONOS_URL.format(asset), os.path.join(RAW, 'models', asset, f'{asset}.glb'), None)]
    files = get_json(API + asset)
    jobs: list[tuple[str, str, int | None]] = []
    if asset in HDRIS:
        for r in HDRIS[asset].split(','):
            e = files['hdri'][r]['hdr']
            jobs.append((e['url'], os.path.join(RAW, 'hdri', f'{asset}_{r}.hdr'), e['size']))
    elif asset in TEXTURES:
        for r in TEXTURES[asset].split(','):
            for m in ('Diffuse', 'nor_gl', 'Rough') if asset in COASTAL_SURFACES else TEX_MAPS:
                e = files[m][r]['jpg']
                jobs.append((e['url'], os.path.join(RAW, 'tex', asset, r, f'{m}.jpg'), e['size']))
    else:
        if 'gltf' not in files:
            print(f'skip   {asset} (no glTF download)')
            return jobs
        e = files['gltf']['1k']['gltf']
        base = os.path.join(RAW, 'models', asset)
        jobs.append((e['url'], os.path.join(base, f'{asset}.gltf'), e['size']))
        for rel, inc in e.get('include', {}).items():
            jobs.append((inc['url'], os.path.join(base, rel), inc['size']))
    return jobs


def unpack_ambient_cg(asset: str) -> None:
    bundle = f'{AMBIENT_CG[asset]}_1K-JPG'
    target = os.path.join(RAW, 'tex', asset, '1k')
    required = {'Color': 'Diffuse', 'NormalGL': 'nor_gl', 'Roughness': 'rough'}
    os.makedirs(target, exist_ok=True)
    with ZipFile(os.path.join(RAW, 'ambientcg', f'{bundle}.zip')) as archive:
        ao = f'{bundle}_AmbientOcclusion.jpg'
        if ao in archive.namelist():
            required['AmbientOcclusion'] = 'ao'
        for source, name in required.items():
            member = f'{bundle}_{source}.jpg'
            dest = os.path.join(target, f'{name}.jpg')
            if os.path.exists(dest) and os.path.getsize(dest) == archive.getinfo(member).file_size:
                continue
            with open(dest + '.part', 'wb') as output:
                output.write(archive.read(member))
            os.replace(dest + '.part', dest)


def main() -> int:
    wanted = sys.argv[1:] or [*HDRIS, *TEXTURES, *AMBIENT_CG, *MODELS, *KHRONOS]
    with ThreadPoolExecutor(6) as ex:
        plans = list(ex.map(jobs_for, (asset for asset in wanted if asset != AMBIENT_LAWN)))
    jobs = [j for p in plans for j in p]
    fails = 0
    with ThreadPoolExecutor(6) as ex:
        futs = [ex.submit(download, *j) for j in jobs]
        for f in futs:
            try:
                print(f.result())
            except Exception as e:  # noqa: BLE001
                fails += 1
                print('FAIL', e)
    if not fails:
        for asset in wanted:
            if asset in AMBIENT_CG:
                unpack_ambient_cg(asset)
    print(f'FETCH_OK {len(jobs) - fails}' if not fails else f'FETCH_FAIL {fails}')
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
