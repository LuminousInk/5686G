#!/usr/bin/env python3
"""Download the assets Cuby Studio uses into studio/.cache/raw/.

    python3 tools/fetch_assets.py            # everything
    python3 tools/fetch_assets.py teak_veneer boulder_01

Poly Haven and ambientCG assets are CC0. The Khronos glTF sample models are CC BY 4.0
(see README "Assets and licences"). Re-running skips files that are already complete.
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
    'laminate_floor_02': '1k,2k',      # light oak floor
    'wood_floor': '1k',                # walnut floor (tinted)
    'wood_planks_grey': '1k',          # ash floor
    'white_oak_veneer': '1k',          # cabinets
    'natural_walnut_veneer': '1k',
    'ash_veneer': '1k',
    'long_white_tiles': '1k',          # bath walls
    'large_grey_tiles': '1k',          # bath floor
    'rough_linen': '1k',               # upholstery, bedding
    'withered_grass': '1k',            # dry summer grasses on coastal slopes
    'gravelly_sand': '1k',            # compacted decomposed-granite proxy
    'coast_sand_rocks_02': '1k',       # sedimentary outcrops and bluffs
    'wood_chip_path': '1k',            # bark-mulched garden beds
}
TEX_MAPS = ('Diffuse', 'nor_gl', 'arm')
COASTAL_SURFACES = {'withered_grass', 'wood_chip_path', 'gravelly_sand', 'coast_sand_rocks_02'}
MODELS = [
    # rock garden
    'boulder_01', 'rock_moss_set_01', 'rock_moss_set_02', 'namaqualand_boulder_02', 'namaqualand_boulders_01',
    'stone_01', 'rock_07', 'rock_09', 'fern_02', 'shrub_04',
    'shrub_03', 'grass_medium_01',
    # interior
    'sofa_03', 'Sofa_01', 'modern_arm_chair_01', 'mid_century_lounge_chair', 'coffee_table_round_01',
    'modern_coffee_table_01', 'dining_table', 'dining_chair_02', 'bar_chair_round_01', 'modern_ceiling_lamp_01',
    'potted_plant_01', 'potted_plant_02', 'potted_plant_04', 'ceramic_vase_01', 'ceramic_vase_02',
    'ceramic_vase_03', 'ceramic_vase_04', 'throw_pillows_01', 'side_table_01',
    'wooden_bowl_01',
    # modern furniture
    'modern_wooden_cabinet', 'wooden_display_shelves_01', 'desk_lamp_arm_01',
]
# Khronos glTF Sample Assets (CC BY 4.0, donated by Wayfair) ship as GLB rather than Poly Haven glTF.
KHRONOS = ('GlamVelvetSofa', 'SheenChair', 'SheenWoodLeatherSofa')
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


def lawn() -> None:
    archive = os.path.join(RAW, 'downloads', LAWN_ARCHIVE)
    print(download(f'https://ambientcg.com/get?file={LAWN_ARCHIVE}', archive, None))
    base = os.path.join(RAW, 'tex', AMBIENT_LAWN, '1k')
    os.makedirs(base, exist_ok=True)
    with ZipFile(archive) as maps:
        for source, dest in [('Color', 'Diffuse'), ('NormalGL', 'nor_gl'), ('Roughness', 'Rough')]:
            target = os.path.join(base, f'{dest}.jpg')
            tmp = target + '.part'
            with open(tmp, 'wb') as output:
                output.write(maps.read(f'{AMBIENT_LAWN}_1K-JPG_{source}.jpg'))
            os.replace(tmp, target)


def main() -> int:
    wanted = sys.argv[1:] or [*HDRIS, *TEXTURES, *MODELS, *KHRONOS, AMBIENT_LAWN]
    if AMBIENT_LAWN in wanted:
        lawn()
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
    print(f'FETCH_OK {len(jobs) - fails}' if not fails else f'FETCH_FAIL {fails}')
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
